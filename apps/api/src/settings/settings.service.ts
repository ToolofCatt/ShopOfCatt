import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type StoreSetting, type User } from '@prisma/client';
import {
  AI_PROVIDERS,
  SUPPORT_CHANNELS_MAX,
  type AdminStoreSettingDto,
  type AiProvider,
  type CryptoNetwork,
  type PaymentMethodDto,
  DISPLAY_CURRENCY_MODES,
  type DisplayCurrencyMode,
  type StoreRatesDto,
  type StoreReadinessDto,
  type SupportChannelDto,
} from '@webcatt/shared';
import { diffChanges } from '../audit/audit-diff';
import { AuditService } from '../audit/audit.service';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Bản ghi cấu hình duy nhất. */
const SETTING_ID = 'main';

/** BEP20 (BSC): 0x + 40 ký tự hex. TRC20 (Tron): T + 33 ký tự base58. */
const BEP20_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TRC20_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Liên kết hỗ trợ chỉ nhận web/email — chặn javascript:, data:… */
const SUPPORT_URL_RE = /^(https?:\/\/|mailto:)/i;

/**
 * Địa chỉ API chỉ nhận http/https.
 *
 * KHÔNG chặn địa chỉ nội bộ: dùng LLM chạy ngay trên máy (Ollama ở
 * http://localhost:11434/v1) là một trong những lý do chính để có ô này. Đổi
 * lại, ai chiếm được tài khoản quản trị có thể bắt máy chủ gọi tới địa chỉ nội
 * bộ bất kỳ — chấp nhận được vì phản hồi chỉ dùng để dịch, không hiện ra đâu.
 */
const AI_BASE_URL_RE = /^https?:\/\//i;

/**
 * Đọc mảng kênh hỗ trợ từ cột JSON. Dữ liệu trong cột có thể do bản cũ ghi vào
 * nên phải kiểm tra từng phần tử thay vì ép kiểu thẳng.
 */
function parseSupportChannels(raw: Prisma.JsonValue): SupportChannelDto[] {
  if (!Array.isArray(raw)) return [];
  const channels: SupportChannelDto[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const value = typeof row.value === 'string' ? row.value.trim() : '';
    if (label === '' || value === '') continue;
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    channels.push(url === '' ? { label, value } : { label, value, url });
  }
  return channels.slice(0, SUPPORT_CHANNELS_MAX);
}

/**
 * Cấu hình cửa hàng (StoreSetting singleton) + danh sách phương thức
 * thanh toán đang bật. Địa chỉ ví không bí mật nên nằm trong DB;
 * khóa API Binance nằm trong biến môi trường.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Đọc bản ghi cấu hình — tự tạo với giá trị mặc định nếu chưa có. */
  async getSetting(): Promise<StoreSetting> {
    return this.prisma.storeSetting.upsert({
      where: { id: SETTING_ID },
      create: { id: SETTING_ID },
      update: {},
    });
  }

  /**
   * Các phương thức thanh toán ĐANG BẬT, theo thứ tự cố định:
   * binance_pay → binance_id → crypto_bep20 → crypto_trc20 → mock.
   *
   * Ba quy tắc an toàn:
   * 1. `mock` chỉ xuất hiện khi biến môi trường PAYMENT_MOCK=true — công tắc
   *    trong CSDL một mình không đủ, vì bật nhầm là phát hàng miễn phí.
   * 2. `mock` luôn xếp CUỐI và bị loại hẳn khi đã có phương thức thật, để đơn
   *    mới không bao giờ mặc định rơi vào cổng giả lập.
   * 3. Không có phương thức nào thì trả về mảng RỖNG — khâu đặt hàng báo lỗi rõ
   *    ràng, thay vì âm thầm quay về mock như trước.
   */
  async getEnabledMethods(): Promise<PaymentMethodDto[]> {
    const setting = await this.getSetting();
    const methods: PaymentMethodDto[] = [];

    const binancePayKey = (
      this.config.get<string>('BINANCE_PAY_API_KEY') ?? ''
    ).trim();
    if (setting.binancePayEnabled && binancePayKey !== '') {
      methods.push({ method: 'binance_pay' });
    }
    const binanceId = setting.binanceId.trim();
    if (setting.binanceIdEnabled && binanceId !== '') {
      const qr = setting.binanceQr.trim();
      methods.push({
        method: 'binance_id',
        address: binanceId,
        ...(qr === '' ? {} : { qr }),
      });
    }
    /*
     * SePay chỉ được chào khi ĐỦ CẢ BỐN: tài khoản, ngân hàng, tỉ giá và khoá
     * API. Thiếu tỉ giá thì không dựng được số tiền để đối chiếu; thiếu khoá API
     * thì webhook bị từ chối và đơn treo tới lúc hết hạn dù khách đã chuyển tiền.
     */
    if (setting.sepayEnabled && sepayReady(setting)) {
      methods.push({
        method: 'sepay',
        address: setting.sepayAccountNumber.trim(),
        bank: setting.sepayBank.trim(),
        ...(setting.sepayAccountHolder.trim() === ''
          ? {}
          : { accountHolder: setting.sepayAccountHolder.trim() }),
      });
    }

    const bep20 = setting.bep20Address.trim();
    if (setting.cryptoEnabled && bep20 !== '') {
      methods.push({ method: 'crypto_bep20', address: bep20 });
    }
    const trc20 = setting.trc20Address.trim();
    if (setting.cryptoEnabled && trc20 !== '') {
      methods.push({ method: 'crypto_trc20', address: trc20 });
    }
    const mockAllowed =
      setting.mockEnabled &&
      (this.config.get<string>('PAYMENT_MOCK') ?? '').trim() === 'true';
    if (mockAllowed && methods.length === 0) {
      methods.push({ method: 'mock' });
    }

    return methods;
  }

  /**
   * Những thứ đang chặn việc bán hàng, để trang tổng quan cảnh báo sớm.
   *
   * `getEnabledMethods` âm thầm bỏ qua phương thức thiếu cấu hình (đúng, vì
   * khách không nên thấy nút thanh toán hỏng) — nhưng chủ shop thì PHẢI biết,
   * nếu không cửa hàng trông vẫn bình thường mà không đơn nào đặt được.
   */
  async getReadiness(): Promise<StoreReadinessDto> {
    const [setting, methods] = await Promise.all([
      this.getSetting(),
      this.getEnabledMethods(),
    ]);
    const binancePayKey = (
      this.config.get<string>('BINANCE_PAY_API_KEY') ?? ''
    ).trim();

    return {
      activePaymentMethods: methods.map((entry) => entry.method),
      binancePayKeyMissing: setting.binancePayEnabled && binancePayKey === '',
      binanceIdMissing: setting.binanceIdEnabled && setting.binanceId.trim() === '',
      sepayIncomplete: setting.sepayEnabled && !sepayReady(setting),
      // Bật nhận tiền mà không có khoá đọc thì không có gì đối soát: khách
      // chuyển xong đơn vẫn treo, chủ shop phải tự đánh dấu từng đơn.
      binanceIdNoReconcile:
        setting.binanceIdEnabled &&
        (this.config.get<string>('BINANCE_API_KEY') ?? '').trim() === '',
      mockActive: methods.some((entry) => entry.method === 'mock'),
      stockAvailable: await this.countAvailableStock(),
      supportChannelsMissing: parseSupportChannels(setting.supportChannels).length === 0,
    };
  }

  /** Số key bán được ngay: AVAILABLE (chưa giữ chỗ, chưa bán) ở loại đang bật. */
  private async countAvailableStock(): Promise<number> {
    return this.prisma.stockItem.count({
      where: {
        status: 'AVAILABLE',
        variant: { active: true, product: { active: true } },
      },
    });
  }

  /** Địa chỉ ví nhận theo mạng — chuỗi rỗng khi chưa cấu hình. */
  async getCryptoAddress(network: CryptoNetwork): Promise<string> {
    const setting = await this.getSetting();
    return (
      network === 'BEP20' ? setting.bep20Address : setting.trc20Address
    ).trim();
  }

  /** Binance ID nhận tiền (rỗng = chưa cấu hình). */
  async getBinanceId(): Promise<string> {
    return (await this.getSetting()).binanceId.trim();
  }

  /** Ảnh QR Binance Pay chủ shop đã tải lên (rỗng = chưa có). */
  async getBinanceQr(): Promise<string> {
    return (await this.getSetting()).binanceQr;
  }

  /**
   * Cấu hình AI cho dịch tự động. Khoá là bí mật nên chỉ TranslationService gọi
   * hàm này; nó không đi qua bất kỳ DTO nào.
   */
  async getAiConfig(): Promise<{
    apiKey: string;
    provider: AiProvider;
    baseUrl: string;
    model: string;
  }> {
    const setting = await this.getSetting();
    return {
      apiKey: setting.aiApiKey.trim(),
      provider: normalizeProvider(setting.aiProvider),
      baseUrl: setting.aiBaseUrl.trim().replace(/\/+$/, ''),
      model: setting.aiModel.trim(),
    };
  }

  /**
   * Cấu hình SePay cho luồng đặt đơn và webhook.
   *
   * Khoá API là bí mật nên chỉ webhook gọi hàm này; nó không đi qua DTO nào.
   */
  async getSepayConfig(): Promise<{
    ready: boolean;
    accountNumber: string;
    bank: string;
    accountHolder: string;
    vndPerUsdt: number;
    apiKey: string;
    webhookSecret: string;
  }> {
    const setting = await this.getSetting();
    return {
      ready: setting.sepayEnabled && sepayReady(setting),
      accountNumber: setting.sepayAccountNumber.trim(),
      bank: setting.sepayBank.trim(),
      accountHolder: setting.sepayAccountHolder.trim(),
      vndPerUsdt: Number(setting.vndPerUsdt),
      apiKey: setting.sepayApiKey.trim(),
      webhookSecret: setting.sepayWebhookSecret.trim(),
    };
  }

  async getAdmin(): Promise<AdminStoreSettingDto> {
    return toAdminDto(await this.getSetting());
  }

  /**
   * Tỉ giá cho trang khách — chỉ để HIỆN giá, không dùng thu tiền.
   *
   * Công khai được: tỉ giá vốn đã hiện ngay trên thẻ sản phẩm.
   */
  async getPublicRates(): Promise<StoreRatesDto> {
    const setting = await this.getSetting();
    return {
      vndPerUsdt: Number(setting.vndPerUsdt),
      cnyPerUsdt: Number(setting.cnyPerUsdt),
      displayCurrency: normalizeCurrency(setting.displayCurrency),
      updatedAt: setting.rateUpdatedAt ? setting.rateUpdatedAt.toISOString() : null,
    };
  }

  /** Thông tin hỗ trợ công khai cho trang đăng nhập. */
  async getSupportInfo(): Promise<{
    supportChannels: SupportChannelDto[];
    supportNote: string;
  }> {
    const setting = await this.getSetting();
    return {
      supportChannels: parseSupportChannels(setting.supportChannels),
      supportNote: setting.supportNote,
    };
  }

  /** Cập nhật cấu hình + ghi nhật ký `settings.update` kèm diff thay đổi. */
  async update(actor: User, dto: UpdateSettingsDto): Promise<AdminStoreSettingDto> {
    // Đọc sớm: vài phép kiểm bên dưới cần biết giá trị CŨ, vì trang quản trị
    // chỉ gửi lên những trường nó thực sự đổi.
    const before0 = await this.getSetting();
    const bep20Address = dto.bep20Address.trim();
    const trc20Address = dto.trc20Address.trim();
    const binanceId = dto.binanceId.trim();

    if (bep20Address !== '' && !BEP20_ADDRESS_RE.test(bep20Address)) {
      throw new BadRequestException(K.adminBep20AddressInvalid);
    }
    if (trc20Address !== '' && !TRC20_ADDRESS_RE.test(trc20Address)) {
      throw new BadRequestException(K.adminTrc20AddressInvalid);
    }
    if (dto.cryptoEnabled && bep20Address === '' && trc20Address === '') {
      throw new BadRequestException(K.adminCryptoAddressRequired);
    }
    // Bật nhận tiền mà chưa có ID thì khách sẽ thấy một phương thức không
    // chuyển đi đâu được — chặn ngay tại đây thay vì để lộ ra trang thanh toán.
    if (dto.binanceIdEnabled && binanceId === '') {
      throw new BadRequestException(K.adminBinanceIdRequired);
    }

    const sepayAccountNumber = dto.sepayAccountNumber.trim();
    const sepayBank = dto.sepayBank.trim();
    const sepayApiKey = dto.sepayApiKey?.trim();
    const sepayWebhookSecret = dto.sepayWebhookSecret?.trim();
    /*
     * Bật SePay mà thiếu cấu hình thì chặn ngay tại đây thay vì để phương thức
     * âm thầm không xuất hiện — chủ shop sẽ tưởng đã bật xong.
     *
     * Khoá API xét theo giá trị SẼ CÓ sau khi lưu: không gửi trường này nghĩa là
     * giữ khoá cũ, nên không được coi là thiếu.
     */
    const khoaSauKhiLuu =
      sepayApiKey === undefined ? before0.sepayApiKey.trim() : sepayApiKey;
    if (
      dto.sepayEnabled &&
      (sepayAccountNumber === '' ||
        sepayBank === '' ||
        dto.vndPerUsdt <= 0 ||
        khoaSauKhiLuu === '')
    ) {
      throw new BadRequestException(K.adminSepayIncomplete);
    }

    const aiApiKey = dto.aiApiKey?.trim();
    // Bỏ dấu / thừa ở cuối để lúc nối đường dẫn không sinh ra "//chat/completions".
    const aiBaseUrl = dto.aiBaseUrl?.trim().replace(/\/+$/, '');
    const aiModel = dto.aiModel?.trim();
    if (aiBaseUrl !== undefined && aiBaseUrl !== '' && !AI_BASE_URL_RE.test(aiBaseUrl)) {
      throw new BadRequestException(K.adminAiBaseUrlInvalid);
    }
    // Anthropic có model mặc định, các nhà cung cấp khác thì không đoán được.
    const aiProviderNext = dto.aiProvider ?? normalizeProvider(before0.aiProvider);
    const aiModelNext = aiModel ?? before0.aiModel.trim();
    if (aiProviderNext === 'openai' && aiModelNext === '') {
      throw new BadRequestException(K.adminAiModelRequired);
    }

    // Kênh hỗ trợ: bỏ dòng trống, kiểm tra liên kết, cắt theo số lượng tối đa.
    const channels: SupportChannelDto[] = [];
    for (const raw of dto.supportChannels ?? []) {
      const label = raw.label.trim();
      const value = raw.value.trim();
      if (label === '' || value === '') continue;
      const url = raw.url?.trim() ?? '';
      if (url !== '' && !SUPPORT_URL_RE.test(url)) {
        throw new BadRequestException(K.adminSupportUrlInvalid);
      }
      channels.push(url === '' ? { label, value } : { label, value, url });
    }
    if (channels.length > SUPPORT_CHANNELS_MAX) {
      throw new BadRequestException(K.adminSupportTooMany);
    }

    const before = before0;

    const data = {
      mockEnabled: dto.mockEnabled,
      binancePayEnabled: dto.binancePayEnabled,
      binanceIdEnabled: dto.binanceIdEnabled,
      binanceId,
      // Bỏ trống (không gửi lên) = giữ ảnh QR cũ, đừng xoá mất.
      binanceQr: dto.binanceQr === undefined ? before.binanceQr : dto.binanceQr.trim(),
      cryptoEnabled: dto.cryptoEnabled,
      bep20Address,
      trc20Address,
      sepayEnabled: dto.sepayEnabled,
      sepayAccountNumber,
      sepayBank,
      sepayAccountHolder: dto.sepayAccountHolder.trim(),
      vndPerUsdt: new Prisma.Decimal(dto.vndPerUsdt.toFixed(2)),
      cnyPerUsdt:
        dto.cnyPerUsdt === undefined
          ? before.cnyPerUsdt
          : new Prisma.Decimal(dto.cnyPerUsdt.toFixed(4)),
      rateAuto: dto.rateAuto ?? before.rateAuto,
      rateMarkupPercent:
        dto.rateMarkupPercent === undefined
          ? before.rateMarkupPercent
          : new Prisma.Decimal(dto.rateMarkupPercent.toFixed(2)),
      rateHour: dto.rateHour ?? before.rateHour,
      displayCurrency: dto.displayCurrency ?? normalizeCurrency(before.displayCurrency),
      // Không gửi = giữ khoá cũ, giống hệt khoá AI.
      sepayApiKey: sepayApiKey === undefined ? before.sepayApiKey : sepayApiKey,
      sepayWebhookSecret:
        sepayWebhookSecret === undefined
          ? before.sepayWebhookSecret
          : sepayWebhookSecret,
      aiProvider: aiProviderNext,
      aiBaseUrl: aiBaseUrl === undefined ? before.aiBaseUrl : aiBaseUrl,
      aiModel: aiModelNext,
      // Không gửi = giữ khoá cũ. Trang quản trị không bao giờ nhận được khoá
      // nên nó KHÔNG THỂ gửi ngược lên — quên nhánh này thì mỗi lần lưu cài đặt
      // là khoá bị xoá mất mà không ai biết.
      aiApiKey: aiApiKey === undefined ? before.aiApiKey : aiApiKey,
      // Bỏ trống (không gửi lên) = giữ nguyên giá trị cũ.
      supportChannels:
        dto.supportChannels === undefined
          ? (before.supportChannels as Prisma.InputJsonValue)
          : (channels as unknown as Prisma.InputJsonValue),
      supportNote: dto.supportNote?.trim() ?? before.supportNote,
    };
    const updated = await this.prisma.storeSetting.update({
      where: { id: SETTING_ID },
      data,
    });

    const changes = diffChanges(toSnapshot(before), toSnapshot(updated));
    await this.audit.log(
      actor,
      'settings.update',
      { type: 'settings', id: SETTING_ID },
      Object.keys(changes).length > 0 ? { changes } : undefined,
    );

    return toAdminDto(updated);
  }
}

function toAdminDto(setting: StoreSetting): AdminStoreSettingDto {
  return {
    mockEnabled: setting.mockEnabled,
    binancePayEnabled: setting.binancePayEnabled,
    binanceIdEnabled: setting.binanceIdEnabled,
    binanceId: setting.binanceId,
    binanceQr: setting.binanceQr,
    cryptoEnabled: setting.cryptoEnabled,
    bep20Address: setting.bep20Address,
    trc20Address: setting.trc20Address,
    sepayEnabled: setting.sepayEnabled,
    sepayAccountNumber: setting.sepayAccountNumber,
    sepayBank: setting.sepayBank,
    sepayAccountHolder: setting.sepayAccountHolder,
    vndPerUsdt: Number(setting.vndPerUsdt),
    cnyPerUsdt: Number(setting.cnyPerUsdt),
    rateAuto: setting.rateAuto,
    rateMarkupPercent: Number(setting.rateMarkupPercent),
    rateHour: setting.rateHour,
    displayCurrency: normalizeCurrency(setting.displayCurrency),
    rateUpdatedAt: setting.rateUpdatedAt ? setting.rateUpdatedAt.toISOString() : null,
    rateSource: setting.rateSource,
    // Cố ý KHÔNG trả khoá về — chỉ "có hay không" + bốn ký tự cuối.
    sepayApiKeySet: setting.sepayApiKey.trim() !== '',
    sepayApiKeyHint: setting.sepayApiKey.trim().slice(-4),
    sepayWebhookSecretSet: setting.sepayWebhookSecret.trim() !== '',
    aiProvider: normalizeProvider(setting.aiProvider),
    aiBaseUrl: setting.aiBaseUrl,
    aiModel: setting.aiModel,
    // Cố ý KHÔNG trả khoá về: chỉ "có hay không" + bốn ký tự cuối để chủ shop
    // nhận ra mình đã dán khoá nào.
    aiKeySet: setting.aiApiKey.trim() !== '',
    aiKeyHint: setting.aiApiKey.trim().slice(-4),
    supportChannels: parseSupportChannels(setting.supportChannels),
    supportNote: setting.supportNote,
  };
}

/** Ảnh chụp phẳng để diff cho nhật ký. */
function toSnapshot(setting: StoreSetting): Record<string, unknown> {
  return {
    mockEnabled: setting.mockEnabled,
    binancePayEnabled: setting.binancePayEnabled,
    cryptoEnabled: setting.cryptoEnabled,
    bep20Address: setting.bep20Address,
    trc20Address: setting.trc20Address,
    sepayEnabled: setting.sepayEnabled,
    sepayAccountNumber: setting.sepayAccountNumber,
    sepayBank: setting.sepayBank,
    sepayAccountHolder: setting.sepayAccountHolder,
    vndPerUsdt: Number(setting.vndPerUsdt),
    cnyPerUsdt: Number(setting.cnyPerUsdt),
    rateAuto: setting.rateAuto,
    rateMarkupPercent: Number(setting.rateMarkupPercent),
    rateHour: setting.rateHour,
    displayCurrency: setting.displayCurrency,
    // BOOLEAN, không phải chính khoá — nhật ký lưu vĩnh viễn.
    sepayApiKeySet: setting.sepayApiKey.trim() !== '',
    sepayWebhookSecretSet: setting.sepayWebhookSecret.trim() !== '',
    aiProvider: setting.aiProvider,
    aiBaseUrl: setting.aiBaseUrl,
    aiModel: setting.aiModel,
    // BOOLEAN, không phải chính khoá: nhật ký lưu vĩnh viễn và hiện ở
    // /admin/audit. Ghi cả chuỗi vào đây là rò bí mật ra một chỗ thứ hai.
    aiKeySet: setting.aiApiKey.trim() !== '',
    supportChannels: parseSupportChannels(setting.supportChannels),
    supportNote: setting.supportNote,
  };
}

/**
 * Cột `aiProvider` là TEXT tự do trong CSDL, nên bản cũ hoặc một lần sửa tay
 * bằng psql có thể để lại giá trị lạ. Quy về "anthropic" thay vì để nó rơi
 * xuống nhánh nào không ai lường trước.
 */
function normalizeProvider(value: string): AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
    ? (value as AiProvider)
    : 'anthropic';
}

/**
 * SePay dùng được chưa. Bốn thứ đều BẮT BUỘC, và thiếu thứ nào cũng dẫn tới
 * cùng một hậu quả: khách chuyển tiền mà đơn không bao giờ được chốt.
 */
function sepayReady(setting: StoreSetting): boolean {
  return (
    setting.sepayAccountNumber.trim() !== '' &&
    setting.sepayBank.trim() !== '' &&
    Number(setting.vndPerUsdt) > 0 &&
    setting.sepayApiKey.trim() !== ''
  );
}

/**
 * Cột `displayCurrency` là TEXT tự do, nên bản cũ hoặc một lần sửa tay bằng psql
 * có thể để lại giá trị lạ. Quy về "auto" thay vì để giao diện rơi vào nhánh nào
 * không ai lường trước.
 */
function normalizeCurrency(value: string): DisplayCurrencyMode {
  return (DISPLAY_CURRENCY_MODES as readonly string[]).includes(value)
    ? (value as DisplayCurrencyMode)
    : 'auto';
}
