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
  TRANSLATABLE_LOCALES,
  type TranslatableLocale,
  type TranslationStatusDto,
} from '@webcatt/shared';
import { ANNOUNCEMENT_ID } from '../announcement/announcement.constants';
import { sanitizeAnnouncementHtml } from '../announcement/sanitize-announcement';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import { VARIANT_ORDER_BY } from '../products/product.mapper';

/** Model dùng để dịch nội dung sang tiếng Anh + tiếng Trung. */
export const TRANSLATION_MODEL = 'claude-opus-5';

const MAX_TOKENS = 16000;
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
 * Không cấu hình ANTHROPIC_API_KEY thì `isConfigured` = false và mọi endpoint
 * dịch trả về lỗi 400 có hướng dẫn — phần còn lại của hệ thống vẫn chạy bình thường.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const apiKey = (config.get<string>('ANTHROPIC_API_KEY') ?? '').trim();
    // SDK tự đọc biến môi trường ANTHROPIC_API_KEY.
    this.client = apiKey ? new Anthropic() : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  getStatus(): TranslationStatusDto {
    return { configured: this.isConfigured, model: TRANSLATION_MODEL };
  }

  /**
   * Dịch toàn bộ một sản phẩm (mô tả + tên mọi loại) trong MỘT lần gọi,
   * rồi lưu lại bằng upsert theo (productId, locale) / (variantId, locale).
   */
  async translateProduct(productId: string): Promise<void> {
    this.assertConfigured();

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
    if (!this.isConfigured) return;
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
    this.assertConfigured();

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

  private assertConfigured(): void {
    if (!this.client) {
      throw new BadRequestException(K.adminTranslationNotConfigured);
    }
  }

  /**
   * Một lượt hỏi Claude với JSON schema bắt buộc → phản hồi luôn đúng hình dạng.
   * Không gửi temperature/top_p/budget_tokens (model này từ chối các tham số đó).
   */
  private async ask<T>(
    system: string,
    payload: unknown,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const client = this.client;
    if (!client) {
      throw new BadRequestException(K.adminTranslationNotConfigured);
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages.create({
        model: TRANSLATION_MODEL,
        max_tokens: MAX_TOKENS,
        betas: TRANSLATION_BETAS,
        fallbacks: 'default',
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema },
        },
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      });
    } catch (error) {
      this.logger.error(
        `Gọi Claude API thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadGatewayException(K.adminTranslationFailed);
    }

    if (message.stop_reason === 'refusal') {
      this.logger.warn('Claude API từ chối yêu cầu dịch');
      throw new BadGatewayException(K.adminTranslationRefused);
    }

    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (!text) {
      this.logger.error('Claude API trả về phản hồi rỗng');
      throw new BadGatewayException(K.adminTranslationFailed);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.error('Không phân tích được JSON từ Claude API');
      throw new BadGatewayException(K.adminTranslationFailed);
    }
  }
}
