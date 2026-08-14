import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type StoreSetting, type User } from '@prisma/client';
import {
  SUPPORT_CHANNELS_MAX,
  type AdminStoreSettingDto,
  type CryptoNetwork,
  type PaymentMethodDto,
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
   * binance_pay → crypto_bep20 → crypto_trc20 → mock.
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
      mockActive: methods.some((entry) => entry.method === 'mock'),
      stockAvailable: await this.countAvailableStock(),
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

  async getAdmin(): Promise<AdminStoreSettingDto> {
    return toAdminDto(await this.getSetting());
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
    const bep20Address = dto.bep20Address.trim();
    const trc20Address = dto.trc20Address.trim();

    if (bep20Address !== '' && !BEP20_ADDRESS_RE.test(bep20Address)) {
      throw new BadRequestException(K.adminBep20AddressInvalid);
    }
    if (trc20Address !== '' && !TRC20_ADDRESS_RE.test(trc20Address)) {
      throw new BadRequestException(K.adminTrc20AddressInvalid);
    }
    if (dto.cryptoEnabled && bep20Address === '' && trc20Address === '') {
      throw new BadRequestException(K.adminCryptoAddressRequired);
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

    const before = await this.getSetting();

    const data = {
      mockEnabled: dto.mockEnabled,
      binancePayEnabled: dto.binancePayEnabled,
      cryptoEnabled: dto.cryptoEnabled,
      bep20Address,
      trc20Address,
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
    cryptoEnabled: setting.cryptoEnabled,
    bep20Address: setting.bep20Address,
    trc20Address: setting.trc20Address,
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
    supportChannels: parseSupportChannels(setting.supportChannels),
    supportNote: setting.supportNote,
  };
}
