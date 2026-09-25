import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AdminMailCatalogDto, MailCatalogDto, MailProviderSettingDto } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';
import { FiveMailClient } from './fivemail.client';
import { MailSettingsInput, MailOfferInput } from './mail.dto';
import { publicMailName } from './mail-public';
import { mailPriceQuote } from './mail-price';
export { mailSalePrice } from './mail-price';

@Injectable()
export class MailCatalogService {
  private refreshTask: Promise<void> | null = null;
  private lastAttempt = 0;
  constructor(private readonly prisma: PrismaService, private readonly client: FiveMailClient) {}

  setting() { return this.prisma.mailProviderSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }); }
  async getSettings(): Promise<MailProviderSettingDto> {
    const s = await this.setting();
    return { tokenSet: !!s.token, tokenSuffix: s.token ? s.token.slice(-4) : '', enabled: s.enabled, currencyConfirmed: s.currencyConfirmed,
      multiplier: s.multiplier.toString(), maxOrderCost: s.maxOrderCost.toString(), maxDailyCost: s.maxDailyCost.toString(), syncedAt: s.syncedAt?.toISOString() ?? null, lastSyncFailed: s.lastSyncFailed };
  }
  async updateSettings(input: MailSettingsInput) {
    const previous = await this.setting();
    const token = input.token?.trim() ?? previous.token;
    const next = { ...previous, ...input, token };
    if (new Prisma.Decimal(next.multiplier).lessThan(1) || new Prisma.Decimal(next.maxOrderCost).lessThanOrEqualTo(0) || new Prisma.Decimal(next.maxDailyCost).lessThanOrEqualTo(0)) throw new BadRequestException(K.mailInvalid);
    if (next.enabled && (!token || !next.currencyConfirmed)) throw new BadRequestException(K.mailNotReady);
    // Token mới phải đọc được catalog trước khi thay; lỗi không phá kết nối đang dùng.
    if (input.token && token !== previous.token) await this.client.list(token, 'gmail-api');
    await this.prisma.mailProviderSetting.update({ where: { id: 1 }, data: { ...input, ...(input.token !== undefined ? { token } : {}) } });
    return this.getSettings();
  }
  async updateOffer(code: string, input: MailOfferInput) {
    return this.updateOffers([code], input);
  }
  async updateOffers(codes: string[], input: MailOfferInput) {
    if (codes.length === 0 || codes.length > 200 || new Set(codes).size !== codes.length) throw new BadRequestException(K.mailInvalid);
    if (!input || Object.values(input).some(value => value === null)) throw new BadRequestException(K.mailInvalid);
    if (input.useMultiplier && (input.saleAmount !== undefined || input.salePrice !== undefined || input.saleCurrency !== undefined)) throw new BadRequestException(K.mailInvalid);
    if (input.saleCurrency !== undefined && input.saleAmount === undefined) throw new BadRequestException(K.mailInvalid);
    if (input.saleAmount !== undefined && input.saleCurrency === undefined) throw new BadRequestException(K.mailInvalid);
    if (input.useMultiplier === false && input.saleAmount === undefined && input.salePrice === undefined) throw new BadRequestException(K.mailInvalid);
    const amount = input.saleAmount ?? input.salePrice;
    const currency = input.saleCurrency ?? 'USDT';
    if (amount !== undefined && (new Prisma.Decimal(amount).lte(0) || (currency === 'VND' && !new Prisma.Decimal(amount).isInteger()))) throw new BadRequestException(K.mailInvalid);
    return this.prisma.$transaction(async tx => {
      if (currency === 'VND') {
        const rate = await tx.storeSetting.findUnique({ where: { id: 'main' }, select: { vndPerUsdt: true } });
        if (!rate?.vndPerUsdt.gt(0)) throw new BadRequestException(K.mailRateRequired);
      }
      // Một lần lưu nhiều dòng là nguyên tử; mã sai không được cập nhật nửa danh sách.
      const rows = await tx.mailOffer.count({ where: { code: { in: codes } } });
      if (rows !== codes.length) throw new NotFoundException(K.mailUnavailable);
      await tx.mailOffer.updateMany({ where: { code: { in: codes } }, data: { active: input.active,
        ...(input.useMultiplier ? { salePrice: null, saleAmount: null, saleCurrency: 'USDT' } : amount !== undefined ? { saleCurrency: currency, saleAmount: amount, salePrice: currency === 'USDT' ? amount : null } : {}) } });
      return { updated: rows };
    });
  }
  refresh(force = false): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    if (!force && Date.now() - this.lastAttempt < 3000) return Promise.resolve();
    this.lastAttempt = Date.now();
    this.refreshTask = this.sync().finally(() => { this.refreshTask = null; });
    return this.refreshTask;
  }
  private async sync() {
    const s = await this.setting();
    if (!s.token) return;
    try {
      const now = new Date();
      const rows = await Promise.all((['gmail-api', 'gmail-account'] as const).map(async category => ({ category, products: await this.client.list(s.token, category) })));
      await this.prisma.$transaction(async tx => {
        // Cùng thứ tự với rent: Setting → Offer, tránh đồng bộ và mua ôm khóa ngược.
        await tx.$queryRaw`SELECT id FROM "MailProviderSetting" WHERE id = 1 FOR UPDATE`;
        const current = await tx.mailProviderSetting.findUniqueOrThrow({ where: { id: 1 } });
        if (current.token !== s.token) return;
        // Không ghi đè trạng thái active/giá quản trị khi đồng bộ nguồn.
        for (const { category, products } of rows) {
          for (const p of products) await tx.mailOffer.upsert({ where: { code: p.code }, create: { code: p.code, name: p.name, stock: p.stock, cost: p.price, category, syncedAt: now },
            update: { name: p.name, stock: p.stock, cost: p.price, category, syncedAt: now } });
          await tx.mailOffer.updateMany({ where: { category, code: { notIn: products.map(p => p.code) } }, data: { stock: 0, syncedAt: now } });
        }
        await tx.mailProviderSetting.update({ where: { id: 1 }, data: { syncedAt: now, lastSyncFailed: false } });
      }, { timeout: 20_000 });
    } catch { await this.prisma.mailProviderSetting.update({ where: { id: 1 }, data: { lastSyncFailed: true } }); throw new ServiceUnavailableException(K.mailProviderUnavailable); }
  }
  catalog(admin: true): Promise<AdminMailCatalogDto>;
  catalog(admin?: false): Promise<MailCatalogDto>;
  async catalog(admin = false): Promise<MailCatalogDto> {
    // Dùng snapshot ngay, chỉ tải nguồn ở nền; khách không bị chờ mỗi poll3giây.
    void this.refresh().catch(() => undefined);
    const [s, rows, rates] = await Promise.all([this.setting(), this.prisma.mailOffer.findMany({ where: admin ? {} : { active: true }, orderBy: { name: 'asc' } }), this.prisma.storeSetting.findUnique({ where: { id: 'main' }, select: { vndPerUsdt: true } })]);
    const stale = !s.syncedAt || Date.now() - s.syncedAt.getTime() > 60_000 || s.lastSyncFailed;
    return { offers: rows.map(p => { const quote = mailPriceQuote(p, s, rates?.vndPerUsdt ?? 0); return { code: admin ? p.code : p.publicId, name: admin ? p.name : publicMailName(p.name), category: p.category as 'gmail-api' | 'gmail-account', price: quote.price.toString(), priceCurrency: quote.currency, priceAmount: quote.amount.toString(), purchasable: quote.ready, stock: p.stock, active: p.active,
      syncedAt: p.syncedAt.toISOString(), ...(admin ? { cost: p.cost.toString(), salePrice: p.salePrice?.toString() ?? null, saleCurrency: p.saleCurrency as 'VND' | 'USDT', saleAmount: p.saleAmount?.toString() ?? null } : {}) }; }),
      purchaseEnabled: s.enabled && s.currencyConfirmed && !!s.token && !stale, stale, syncedAt: s.syncedAt?.toISOString() ?? null };
  }
}
