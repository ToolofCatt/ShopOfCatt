import { Injectable, BadRequestException } from '@nestjs/common';
import type { TelegramAdmin } from '@prisma/client';
import { formatUsdt, telegramAdminAllows } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from '../admin/admin.service';
import { CustomersService } from '../customers/customers.service';
import { CouponsService } from '../coupons/coupons.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { LegalService } from '../legal/legal.service';
import type { BotLang } from '../telegram/messages';
import type { OrderStatusFilter } from '../admin/dto/orders-query.dto';
import type { StockStatusFilter } from '../admin/dto/stock-query.dto';
import { adminText as t, homeLinks, type AdminLink } from './views';
import { K } from '../i18n/messages';

export interface ScreenData {
  title: string;
  lines: string[];
  links: AdminLink[];
}
const PAGE_SIZE = 8;

@Injectable()
export class TelegramAdminScreensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly customers: CustomersService,
    private readonly coupons: CouponsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly announcement: AnnouncementService,
    private readonly legal: LegalService,
  ) {}

  async load(
    route: string,
    actor: TelegramAdmin,
    lang: BotLang,
  ): Promise<ScreenData> {
    const [kind, id = '', rawPage = '1', filter = 'ALL', ...query] =
      route.split('|');
    const page = Math.max(1, Math.min(10000, Number(rawPage) || 1));
    const search = query.join('|');
    const data: ScreenData = { title: t(lang, kind), lines: [], links: [] };
    const link = (label: string, route: string, min?: AdminLink['min']) =>
      data.links.push({ label, route, min });
    const action = (label: string, command: string, target = id) =>
      data.links.push({ label: t(lang, label), command, target });
    const paginate = (total: number) => {
      if (page > 1) link('←', `${kind}|${id}|${page - 1}|${filter}|${search}`);
      if (page * PAGE_SIZE < total)
        link('→', `${kind}|${id}|${page + 1}|${filter}|${search}`);
    };
    switch (kind) {
      case 'home':
        data.title = t(lang, 'title');
        data.lines = [actor.name, t(lang, actor.permission)];
        data.links = homeLinks(lang);
        break;
      case 'overview': {
        const stats = await this.admin.getStats();
        data.lines = [
          `${t(lang, 'revenue')}: ${formatUsdt(stats.revenue)}`,
          `${t(lang, 'orders')}: ${stats.ordersTotal}`,
          `${t(lang, 'pending')}: ${stats.ordersPending}`,
          `${t(lang, 'stock')}: ${stats.readiness.stockAvailable}`,
          `${t(lang, 'lowStock')}: ${stats.lowStock.length}`,
        ];
        for (const row of stats.lowStock.slice(0, 8))
          link(
            `${row.name} / ${row.variantName}: ${row.availableStock}`,
            `variant|${row.variantId}`,
          );
        break;
      }
      case 'orders': {
        const status = [
          'PENDING',
          'PAID',
          'DELIVERED',
          'EXPIRED',
          'CANCELLED',
        ].includes(filter)
          ? (filter as OrderStatusFilter)
          : undefined;
        const rows = await this.admin.listOrders({
          page,
          limit: PAGE_SIZE,
          status,
          q: search || undefined,
          userId: id || undefined,
        });
        for (const row of rows.items)
          link(
            `${row.code} · ${row.status} · ${formatUsdt(row.totalAmount)}`,
            `order|${row.code}`,
          );
        if (!id) {
          link(t(lang, 'search'), 'search|orders');
          for (const state of [
            'ALL',
            'PENDING',
            'PAID',
            'DELIVERED',
            'EXPIRED',
            'CANCELLED',
          ])
            link(state, `orders||1|${state}`);
        }
        paginate(rows.total);
        break;
      }
      case 'order': {
        const order = await this.admin.getOrderDetail(id);
        data.title = order.code;
        data.lines = [
          order.status,
          formatUsdt(order.totalAmount),
          order.userEmail ?? `#${order.userCode}`,
          ...order.items.map(
            (i) => `${i.productName} / ${i.variantName ?? ''} × ${i.quantity}`,
          ),
        ];
        if (order.status === 'PENDING') action('cancel', 'order.cancel');
        if (order.status === 'PAID') action('redeliver', 'order.redeliver');
        if (order.status === 'PENDING' || order.status === 'EXPIRED')
          action('markPaid', 'order.markPaid');
        if (order.status === 'DELIVERED')
          link(t(lang, 'keys'), `export-order|${id}`, 'FULL');
        link(t(lang, 'back'), 'orders');
        break;
      }
      case 'products': {
        const all = (await this.admin.listProducts()).filter(
          (p) =>
            !search ||
            `${p.name} ${p.slug}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
        );
        for (const row of all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE))
          link(`${row.name} · ${row.availableStock}`, `product|${row.id}`);
        action('add', 'product.create', 'NEW');
        link(t(lang, 'search'), 'search|products');
        paginate(all.length);
        break;
      }
      case 'product': {
        const p = await this.admin.loadProduct(id);
        data.title = p.name;
        data.lines = [
          p.slug,
          `${p.availableStock} / ${p.sold}`,
          p.active ? t(lang, 'active') : t(lang, 'inactive'),
        ];
        for (const v of p.variants)
          link(
            `${v.name} · ${v.priceAmount} ${v.priceCurrency} · ${v.availableStock}`,
            `variant|${v.id}`,
          );
        action('edit', 'product.edit');
        action('add', 'variant.create');
        action('translate', 'product.translate');
        action('remove', 'product.delete');
        link(t(lang, 'back'), 'products');
        break;
      }
      case 'variant': {
        const v = await this.prisma.productVariant.findUniqueOrThrow({
          where: { id },
          include: { product: { select: { name: true } } },
        });
        const count = await this.prisma.stockItem.groupBy({
          by: ['status'],
          where: { variantId: id },
          _count: { _all: true },
        });
        data.title = `${v.product.name} / ${v.name}`;
        data.lines = [
          `${v.priceAmount} ${v.priceCurrency}`,
          ...count.map((r) => `${r.status}: ${r._count._all}`),
        ];
        action('edit', 'variant.edit');
        action('import', 'stock.import');
        action('withdraw', 'stock.withdraw');
        action('remove', 'variant.delete');
        link(t(lang, 'stock'), `stock|${id}`);
        link(t(lang, 'back'), `product|${v.productId}`);
        break;
      }
      case 'stock': {
        const status = ['AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN'].includes(
          filter,
        )
          ? (filter as StockStatusFilter)
          : undefined;
        // VIEWER/OPERATOR không đọc nội dung key; chỉ metadata để khôi phục.
        const where = { variantId: id, ...(status ? { status } : {}) };
        const [rows, total] = await Promise.all([
          this.prisma.stockItem.findMany({
            where,
            select: { id: true, status: true },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
          }),
          this.prisma.stockItem.count({ where }),
        ]);
        for (const row of rows)
          link(`${row.status} · ${row.id.slice(-8)}`, `stock-item|${row.id}`);
        for (const state of [
          'ALL',
          'AVAILABLE',
          'RESERVED',
          'SOLD',
          'WITHDRAWN',
        ])
          link(state, `stock|${id}|1|${state}`);
        link(t(lang, 'export'), `export-stock|${id}|1|${filter}`, 'FULL');
        paginate(total);
        link(t(lang, 'back'), `variant|${id}`);
        break;
      }
      case 'stock-item': {
        const row = await this.prisma.stockItem.findUniqueOrThrow({
          where: { id },
          select: { id: true, status: true, variantId: true },
        });
        data.title = row.id;
        data.lines = [row.status];
        if (row.status === 'WITHDRAWN') action('restore', 'stock.restore');
        if (row.status === 'AVAILABLE') action('remove', 'stock.delete');
        link(t(lang, 'keys'), `export-key|${id}`, 'FULL');
        link(t(lang, 'back'), `stock|${row.variantId}`);
        break;
      }
      case 'customers': {
        const rows = await this.customers.list({
          page,
          limit: PAGE_SIZE,
          q: search || undefined,
        });
        for (const row of rows.items)
          link(
            `${row.email ?? row.telegramName ?? row.code} · #${row.code}`,
            `customer|${row.id}`,
          );
        link(t(lang, 'search'), 'search|customers');
        paginate(rows.total);
        break;
      }
      case 'customer': {
        const row = await this.customers.getOne(id);
        data.title = `#${row.code}`;
        data.lines = [
          row.email ?? row.telegramName,
          row.role,
          `${row.ordersCount} · ${formatUsdt(row.totalSpent)}`,
        ];
        link(t(lang, 'orders'), `orders|${id}`);
        if (row.role === 'USER') {
          action(
            row.lockedAt ? 'unlock' : 'lock',
            row.lockedAt ? 'customer.unlock' : 'customer.lock',
          );
          action('resetPassword', 'customer.reset');
        }
        link(t(lang, 'back'), 'customers');
        break;
      }
      case 'coupons': {
        const rows = await this.coupons.list();
        for (const row of rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE))
          link(
            `${row.code} · ${row.active ? t(lang, 'active') : t(lang, 'inactive')}`,
            `coupon|${row.id}`,
          );
        action('add', 'coupon.create', 'NEW');
        paginate(rows.length);
        break;
      }
      case 'coupon': {
        const row = (await this.coupons.list()).find((r) => r.id === id);
        if (!row) throw new BadRequestException(K.orderNotFound);
        data.title = row.code;
        data.lines = [
          `${row.type}: ${row.value}`,
          `${row.usedCount} / ${row.maxUses ?? '-'}`,
        ];
        action('edit', 'coupon.edit');
        action('remove', 'coupon.delete');
        link(t(lang, 'back'), 'coupons');
        break;
      }
      case 'content':
        link(t(lang, 'announcement'), 'announcement');
        link(t(lang, 'legal'), 'legal');
        break;
      case 'announcement': {
        const row = await this.announcement.getAdmin();
        data.title = row.title;
        data.lines = [
          row.active ? t(lang, 'active') : t(lang, 'inactive'),
          row.body,
        ];
        action('edit', 'announcement.edit', 'main');
        action('translate', 'announcement.translate', 'main');
        break;
      }
      case 'legal':
        for (const row of await this.legal.listAdmin())
          link(row.title || row.slug, `policy|${row.slug}`);
        break;
      case 'policy': {
        const row = await this.legal.getPublic(id);
        data.title = row.title || id;
        data.lines = [row.body];
        action('edit', 'legal.edit');
        break;
      }
      case 'settings': {
        const readiness = await this.settings.getReadiness();
        data.lines = [readiness.activePaymentMethods.join(', ') || '-'];
        for (const group of ['payments', 'rates', 'support', 'ai', 'alerts'])
          link(t(lang, group), `setting|${group}`);
        break;
      }
      case 'setting': {
        const row = await this.settings.getAdmin();
        data.title = t(lang, id);
        const fields: Record<string, string[]> = {
          payments: [
            'binancePayEnabled',
            'binanceIdEnabled',
            'binanceId',
            'cryptoEnabled',
            'bep20Address',
            'trc20Address',
            'sepayEnabled',
            'sepayBank',
            'sepayAccountNumber',
            'sepayAccountHolder',
          ],
          rates: [
            'vndPerUsdt',
            'cnyPerUsdt',
            'rateAuto',
            'rateMarkupPercent',
            'rateHour',
          ],
          support: ['supportChannels', 'supportNote'],
          ai: ['aiProvider', 'aiBaseUrl', 'aiModel'],
          alerts: [
            'telegramOwnerChatId',
            'telegramOwnerLowStockThreshold',
            'telegramOwnerLowStockAlertsEnabled',
          ],
        };
        data.lines = (fields[id] ?? []).map(
          (key) =>
            `${t(lang, key)}: ${JSON.stringify((row as unknown as Record<string, unknown>)[key])}`,
        );
        action('edit', `settings.${id}`, 'main');
        break;
      }
      case 'audit': {
        const rows = await this.audit.list({ page, limit: PAGE_SIZE });
        data.lines = rows.items.map(
          (r) =>
            `${r.createdAt} · ${r.action}\n${r.telegramName ?? r.actorEmail} · ${r.entityId ?? ''}`,
        );
        paginate(rows.total);
        break;
      }
      default:
        throw new BadRequestException(K.forbidden);
    }
    if (!data.lines.length)
      data.lines = [data.links.length ? `${page}` : t(lang, 'empty')];
    if (kind !== 'home') link(t(lang, 'back'), 'home');
    link(t(lang, 'refresh'), route);
    link(t(lang, 'store'), 'exit');
    return data;
  }

  async export(route: string, actor: TelegramAdmin) {
    if (!telegramAdminAllows(actor.permission, 'FULL'))
      throw new BadRequestException(K.forbidden);
    const [kind, id, , filter] = route.split('|');
    if (kind === 'export-order') {
      const row = await this.admin.getOrderDetail(id!);
      return {
        name: `${row.code}.txt`,
        text: row.items.flatMap((i) => i.deliveredLines ?? []).join('\n'),
      };
    }
    const where =
      kind === 'export-key'
        ? { id }
        : {
            variantId: id,
            ...(['AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN'].includes(
              filter ?? '',
            )
              ? { status: filter as StockStatusFilter }
              : {}),
          };
    const count = await this.prisma.stockItem.count({ where });
    if (count > 1000) throw new BadRequestException(K.adminLimitInvalid);
    const rows = await this.prisma.stockItem.findMany({
      where,
      select: { content: true },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    return { name: 'stock.txt', text: rows.map((r) => r.content).join('\n') };
  }
}
