import Anthropic from '@anthropic-ai/sdk';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_DEFAULT_MODEL,
  TRANSLATABLE_LOCALES,
  type AiProvider,
  type TranslatableLocale,
  type TranslationStatusDto,
} from '@webcatt/shared';
import { ANNOUNCEMENT_ID } from '../announcement/announcement.constants';
import { sanitizeAnnouncementHtml } from '../announcement/sanitize-announcement';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { VARIANT_ORDER_BY } from '../products/product.mapper';

/** Model mặc định khi chủ shop để trống ô model. */
export const TRANSLATION_MODEL = AI_DEFAULT_MODEL;

const MAX_TOKENS = 16000;
/**
 * Hạn chờ khi gọi nhà cung cấp theo chuẩn OpenAI.
 *
 * SDK Anthropic tự có hạn chờ, còn `fetch` trần thì KHÔNG — thiếu dòng này là
 * một nhà cung cấp treo sẽ giữ request quản trị lại vô hạn.
 */
const OPENAI_TIMEOUT_MS = 120_000;
/** Cho phép máy chủ tự chuyển sang model dự phòng khi bị từ chối. */
const TRANSLATION_BETAS = ['server-side-fallback-2026-07-01'];

const PRODUCT_SYSTEM_PROMPT = [
  'You are a professional e-commerce translator for a Vietnamese digital-goods store.',
  'The user message is a JSON object with the Vietnamese source content of one product.',
  'Translate it into English ("en") and Simplified Chinese ("zh").',
  '',
  'Rules:',
  '- Keep product, brand, platform and edition names, licence codes, version numbers and currencies untranslated (e.g. "Windows 11 Pro", "Microsoft Office 2021 Pro Plus", "Steam", "Canva Pro", "USDT").',
  '- Preserve the layout of "description" exactly: keep the blank line between paragraphs, and keep every line that starts with "- " as a bullet line that still starts with "- ".',
  '- Translate every entry of "variants" and echo back the exact "id" you were given for each one.',
  '- Write natural, concise copy a native speaker would use. Do not add, drop or reorder information.',
  '- If a source field is an empty string, return an empty string for it.',
  '- Return only the requested fields.',
].join('\n');

const ANNOUNCEMENT_SYSTEM_PROMPT = [
  'You are a professional e-commerce translator for a Vietnamese digital-goods store.',
  'The user message is a JSON object with the Vietnamese source text of the storefront announcement box.',
  'Translate it into English ("en") and Simplified Chinese ("zh").',
  '',
  'Rules:',
  '- Keep brand names, product names, codes and currencies untranslated (e.g. "Binance Pay", "USDT").',
  '- "body" is HTML. Translate ONLY the visible text between tags.',
  '  Reproduce every tag, its order and its attributes byte-for-byte; never add,',
  '  drop, reorder or rename tags; never wrap the result in extra markup or code fences.',
  '- Keep the tone of a short shop notice: clear, direct, no added marketing.',
  '- If a source field is an empty string, return an empty string for it.',
  '- Return only the requested fields.',
].join('\n');

function productSide(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      shortDescription: { type: 'string' },
      description: { type: 'string' },
      category: { type: 'string' },
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
          additionalProperties: false,
        },
      },
    },
    required: ['name', 'shortDescription', 'description', 'category', 'variants'],
    additionalProperties: false,
  };
}

function announcementSide(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  };
}

function bothLocales(side: () => Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: { en: side(), zh: side() },
    required: ['en', 'zh'],
    additionalProperties: false,
  };
}

interface TranslatedVariant {
  id?: unknown;
  name?: unknown;
}

interface TranslatedProductSide {
  name?: unknown;
  shortDescription?: unknown;
  description?: unknown;
  category?: unknown;
  variants?: TranslatedVariant[];
}

interface TranslatedAnnouncementSide {
  title?: unknown;
  body?: unknown;
}

type TranslationResult<T> = Partial<Record<TranslatableLocale, T>>;

/** Bản dịch rỗng → giữ nguyên bản gốc. */
function clean(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** Bản dịch rỗng cho cột nullable → null. */
function cleanNullable(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Dịch nội dung sản phẩm / thông báo sang tiếng Anh + tiếng Trung bằng Claude API.
 * Không có khoá thì `isConfigured` = false và mọi endpoint dịch trả về lỗi 400
 * có hướng dẫn — phần còn lại của hệ thống vẫn chạy bình thường.
 *
 * Khoá đọc THEO TỪNG LẦN GỌI chứ không chốt lúc khởi động: chủ shop dán khoá ở
 * /admin/settings thì phải dùng được ngay, không phải dựng lại container.
 */
interface AiConfig {
  key: string;
  source: TranslationStatusDto['source'];
  provider: AiProvider;
  baseUrl: string;
  model: string;
}

export interface TranslationConnectionProbe {
  configured: boolean;
  connected: boolean;
  detail: string;
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  /** Khoá + địa chỉ ứng với `cachedClient` — đổi cái nào cũng phải dựng lại. */
  private cachedSignature = '';
  private cachedClient: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cấu hình đang dùng. Cài đặt được ưu tiên hơn biến môi trường: chủ shop sửa
   * được ô trong cài đặt, còn biến môi trường thì không, nên thứ sửa được phải
   * thắng — nếu ngược lại thì dán khoá mới mà không có tác dụng.
   */
  private async resolveConfig(): Promise<AiConfig> {
    const cai = await this.settings.getAiConfig();
    const chung = {
      provider: cai.provider,
      baseUrl: cai.baseUrl,
      model: cai.model === '' ? TRANSLATION_MODEL : cai.model,
    };
    if (cai.apiKey !== '') {
      return { key: cai.apiKey, source: 'settings', ...chung };
    }
    // Biến môi trường chỉ có khoá, nên nó luôn đi kèm cấu hình trong CSDL —
    // vốn mặc định là Anthropic, đúng với thời trước khi có ô cài đặt này.
    const fromEnv = (this.config.get<string>('ANTHROPIC_API_KEY') ?? '').trim();
    if (fromEnv !== '') return { key: fromEnv, source: 'env', ...chung };
    return { key: '', source: null, ...chung };
  }

  /** Client Anthropic, dựng lại khi khoá hoặc địa chỉ gốc đổi. */
  private getAnthropicClient(cfg: AiConfig): Anthropic {
    const chuKy = `${cfg.key}|${cfg.baseUrl}`;
    if (this.cachedClient === null || chuKy !== this.cachedSignature) {
      // Truyền khoá thẳng vào SDK thay vì để nó tự đọc biến môi trường — khoá
      // trong CSDL không có mặt ở process.env.
      this.cachedClient = new Anthropic({
        apiKey: cfg.key,
        ...(cfg.baseUrl === '' ? {} : { baseURL: cfg.baseUrl }),
      });
      this.cachedSignature = chuKy;
    }
    return this.cachedClient;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveConfig()).key !== '';
  }

  async getStatus(): Promise<TranslationStatusDto> {
    const cfg = await this.resolveConfig();
    return {
      configured: cfg.source !== null,
      source: cfg.source,
      provider: cfg.provider,
      model: cfg.model,
    };
  }

  /** Kiểm tra khóa/kết nối mà không gửi nội dung và không tạo token dịch. */
  async probeConnection(): Promise<TranslationConnectionProbe> {
    const cfg = await this.resolveConfig();
    if (cfg.key === '') return { configured: false, connected: false, detail: 'AI dịch đang tắt.' };
    try {
      if (cfg.provider === 'anthropic') {
        await this.getAnthropicClient(cfg).models.list({ limit: 1 });
      } else {
        const base = cfg.baseUrl === '' ? 'https://api.openai.com/v1' : cfg.baseUrl;
        const response = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${cfg.key}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      return { configured: true, connected: true, detail: `${cfg.provider} kết nối được; model ${cfg.model}.` };
    } catch (error) {
      return { configured: true, connected: false, detail: `Không kết nối được ${cfg.provider}: ${moTaLoi(error).slice(0, 180)}` };
    }
  }

  /**
   * Dịch toàn bộ một sản phẩm (mô tả + tên mọi loại) trong MỘT lần gọi,
   * rồi lưu lại bằng upsert theo (productId, locale) / (variantId, locale).
   */
  async translateProduct(productId: string): Promise<void> {
    await this.assertConfigured();

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: { orderBy: VARIANT_ORDER_BY } },
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }

    const source = {
      name: product.name,
      shortDescription: product.shortDescription ?? '',
      description: product.description ?? '',
      category: product.category ?? '',
      variants: product.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
      })),
    };

    const result = await this.ask<TranslationResult<TranslatedProductSide>>(
      PRODUCT_SYSTEM_PROMPT,
      source,
      bothLocales(productSide),
    );

    const variantNames = new Map(product.variants.map((v) => [v.id, v.name]));

    for (const locale of TRANSLATABLE_LOCALES) {
      const side = result[locale];
      if (!side) continue;

      const data = {
        name: clean(side.name, product.name),
        shortDescription: cleanNullable(side.shortDescription),
        description: cleanNullable(side.description),
        category: cleanNullable(side.category),
      };
      await this.prisma.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale } },
        create: { productId: product.id, locale, ...data },
        update: data,
      });

      for (const variant of side.variants ?? []) {
        const id = typeof variant.id === 'string' ? variant.id : '';
        const original = variantNames.get(id);
        if (original === undefined) continue;
        const name = clean(variant.name, original);
        await this.prisma.productVariantTranslation.upsert({
          where: { variantId_locale: { variantId: id, locale } },
          create: { variantId: id, locale, name },
          update: { name },
        });
      }
    }
  }

  /**
   * Bản "chạy nền" — gọi sau khi tạo/sửa sản phẩm và KHÔNG await, lỗi chỉ ghi log
   * để thao tác lưu của quản trị viên luôn phản hồi tức thì.
   */
  async translateProductSafe(productId: string): Promise<void> {
    if (!(await this.isConfigured())) return;
    try {
      await this.translateProduct(productId);
      this.logger.log(`Đã dịch xong sản phẩm ${productId}`);
    } catch (error) {
      this.logger.warn(
        `Dịch nền thất bại cho sản phẩm ${productId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Dịch hộp thông báo trang chủ và lưu lại theo (announcementId, locale). */
  async translateAnnouncement(): Promise<void> {
    await this.assertConfigured();

    const announcement = await this.prisma.announcement.findUnique({
      where: { id: ANNOUNCEMENT_ID },
    });
    const title = announcement?.title.trim() ?? '';
    const body = announcement?.body.trim() ?? '';
    if (!title && !body) {
      throw new BadRequestException(K.adminAnnouncementEmpty);
    }

    const result = await this.ask<TranslationResult<TranslatedAnnouncementSide>>(
      ANNOUNCEMENT_SYSTEM_PROMPT,
      { title, body },
      bothLocales(announcementSide),
    );

    for (const locale of TRANSLATABLE_LOCALES) {
      const side = result[locale];
      if (!side) continue;
      // Bản dịch là HTML do máy sinh ra → lọc lại theo đúng danh sách thẻ cho phép.
      const data = {
        title: clean(side.title, title),
        body: sanitizeAnnouncementHtml(clean(side.body, body)),
      };
      await this.prisma.announcementTranslation.upsert({
        where: {
          announcementId_locale: { announcementId: ANNOUNCEMENT_ID, locale },
        },
        create: { announcementId: ANNOUNCEMENT_ID, locale, ...data },
        update: data,
      });
    }
  }

  private async assertConfigured(): Promise<void> {
    if (!(await this.isConfigured())) {
      throw new BadRequestException(K.adminTranslationNotConfigured);
    }
  }

  /** Một lượt hỏi, định tuyến theo chuẩn giao thức chủ shop đã chọn. */
  private async ask<T>(
    system: string,
    payload: unknown,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const cfg = await this.resolveConfig();
    if (cfg.key === '') {
      throw new BadRequestException(K.adminTranslationNotConfigured);
    }

    const text =
      cfg.provider === 'openai'
        ? await this.hoiOpenAi(cfg, system, payload, schema)
        : await this.hoiAnthropic(cfg, system, payload, schema);

    if (text.trim() === '') {
      this.logger.error(`${cfg.provider}: phản hồi rỗng`);
      throw new BadGatewayException(K.adminTranslationFailed);
    }
    try {
      return JSON.parse(boVoMa(text)) as T;
    } catch {
      this.logger.error(`${cfg.provider}: không phân tích được JSON`);
      throw new BadGatewayException(K.adminTranslationFailed);
    }
  }

  /**
   * Anthropic. Với địa chỉ gốc mặc định thì dùng luôn `output_config` +
   * `json_schema` cho phản hồi đúng hình dạng ngay từ đầu. Với địa chỉ gốc do
   * chủ shop tự đặt thì KHÔNG dùng: đó là các tính năng riêng của Anthropic,
   * proxy trung gian thường chưa hỗ trợ và sẽ trả 400 khó hiểu. Lúc đó nhét
   * schema vào lời nhắc — kém chặt hơn, nhưng chạy được ở mọi nơi.
   */
  private async hoiAnthropic(
    cfg: AiConfig,
    system: string,
    payload: unknown,
    schema: Record<string, unknown>,
  ): Promise<string> {
    const client = this.getAnthropicClient(cfg);
    const chinhChu = cfg.baseUrl === '';
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: MAX_TOKENS,
        // Không gửi temperature/top_p/budget_tokens — model này từ chối.
        ...(chinhChu
          ? {
              betas: TRANSLATION_BETAS,
              fallbacks: 'default' as const,
              output_config: {
                effort: 'low' as const,
                format: { type: 'json_schema' as const, schema },
              },
            }
          : {}),
        system: chinhChu ? system : themSchemaVaoLoiNhac(system, schema),
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      });
    } catch (error) {
      this.logger.error(`Gọi Anthropic thất bại: ${moTaLoi(error)}`);
      throw new BadGatewayException(K.adminTranslationFailed);
    }

    if (message.stop_reason === 'refusal') {
      this.logger.warn('Anthropic từ chối yêu cầu dịch');
      throw new BadGatewayException(K.adminTranslationRefused);
    }
    return message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
  }

  /**
   * Chuẩn OpenAI `/chat/completions` — dùng chung cho OpenRouter, DeepSeek,
   * Groq, Together, Ark, Ollama nội bộ… Gọi bằng `fetch` chứ không thêm gói SDK
   * mới: yêu cầu chỉ là một POST JSON, thêm phụ thuộc chẳng đổi lại được gì.
   *
   * Thử `json_schema` trước rồi lùi về `json_object`: nhiều nhà cung cấp chưa
   * làm `json_schema` và trả 400: cứ thế bỏ cuộc thì phần lớn nhà cung cấp
   * không dùng được, mà đó lại chính là điều ô cấu hình này sinh ra để giải quyết.
   */
  private async hoiOpenAi(
    cfg: AiConfig,
    system: string,
    payload: unknown,
    schema: Record<string, unknown>,
  ): Promise<string> {
    const goc = cfg.baseUrl === '' ? 'https://api.openai.com/v1' : cfg.baseUrl;
    const url = `${goc}/chat/completions`;

    const goi = async (chatChe: boolean) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content: chatChe ? system : themSchemaVaoLoiNhac(system, schema),
            },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          response_format: chatChe
            ? { type: 'json_schema', json_schema: { name: 'ban_dich', strict: true, schema } }
            : { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      });
      return { ok: res.ok, status: res.status, than: await res.text() };
    };

    let r = await goi(true);
    if (!r.ok && r.status === 400) {
      this.logger.warn('Nhà cung cấp từ chối json_schema, thử lại bằng json_object');
      r = await goi(false);
    }
    if (!r.ok) {
      this.logger.error(`Gọi ${goc} thất bại: HTTP ${r.status} ${r.than.slice(0, 300)}`);
      throw new BadGatewayException(K.adminTranslationFailed);
    }

    let data: OpenAiResponse;
    try {
      data = JSON.parse(r.than) as OpenAiResponse;
    } catch {
      this.logger.error(`Phản hồi từ ${goc} không phải JSON`);
      throw new BadGatewayException(K.adminTranslationFailed);
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'content_filter') {
      this.logger.warn('Nhà cung cấp từ chối yêu cầu dịch');
      throw new BadGatewayException(K.adminTranslationRefused);
    }
    return (choice?.message?.content ?? '').trim();
  }
}

/** Hình dạng tối thiểu của phản hồi /chat/completions mà mã này thực sự đọc. */
interface OpenAiResponse {
  choices?: {
    message?: { content?: string };
    finish_reason?: string;
  }[];
}

/**
 * Khi không ép được hình dạng phản hồi ở tầng API thì mô tả nó trong lời nhắc.
 * Kém chặt hơn `json_schema`, nhưng các hàm `clean`/`cleanNullable` bên trên đã
 * chịu được trường thiếu, nên phản hồi lệch một chút vẫn không làm hỏng dữ liệu.
 */
function themSchemaVaoLoiNhac(system: string, schema: Record<string, unknown>): string {
  return [
    system,
    '',
    'Return ONLY a JSON object matching this JSON Schema.',
    'No prose, no explanation, no markdown code fence.',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Gỡ rào ```json ... ``` quanh phản hồi.
 *
 * Cần thiết vì nhiều model vẫn bọc kết quả trong rào markdown dù đã được dặn là
 * đừng — và chỉ một rào thừa là JSON.parse hỏng, đơn dịch coi như thất bại.
 */
function boVoMa(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function moTaLoi(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
