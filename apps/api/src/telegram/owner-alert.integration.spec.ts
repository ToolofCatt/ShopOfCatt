import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient, type Order, type OrderStatus, type PaymentStatus } from '@prisma/client';
import { FulfillmentService } from '../orders/fulfillment.service';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AnnouncementService } from '../announcement/announcement.service';
import type { BalanceService } from '../balance/balance.service';
import type { OrdersService } from '../orders/orders.service';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProductsService } from '../products/products.service';
import type { SettingsService } from '../settings/settings.service';
import type { StorefrontService } from '../storefront/storefront.service';
import type { TelegramUsersService } from './telegram-users.service';
import { TelegramService } from './telegram.service';

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_telegram_owner_alert_test';

function urlForDatabase(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function newClient(database: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: urlForDatabase(database) } },
  });
}

async function applyMigrations(client: PrismaClient): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  for (const folder of readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    for (const statement of sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await client.$executeRawUnsafe(statement);
    }
  }
}

let reachable = false;
let prisma: PrismaClient;
let service: TelegramService;
let variantId = '';
let newOrderId = '';
let stuckOrderId = '';
const config = {
  enabled: true, token: 'token-test', sendAnnouncement: true, stockAlertsEnabled: true,
  greeting: '', ownerChatId: '-1001234567890', ownerOrderAlertsEnabled: true,
  ownerStuckAlertsEnabled: true, ownerStuckMinutes: 5,
  ownerLowStockAlertsEnabled: true, ownerLowStockThreshold: 3,
};
let makeOrder: (code: string, createdAt: Date, isStuck: boolean,
  overrides?: { status?: OrderStatus; paidAt?: Date; paymentStatus?: PaymentStatus; mode?: string }) => Promise<Order>;

beforeAll(async () => {
  const probe = newClient('postgres');
  try {
    await probe.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    // Tự skip khi không có PostgreSQL, cùng quy ước với các integration khác.
  } finally {
    await probe.$disconnect();
  }
  if (!reachable) return;

  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.$disconnect();
  }
  prisma = newClient(TEST_DB);
  await applyMigrations(prisma);

  const settings = {
    getTelegramConfig: async () => config,
  } as unknown as SettingsService;
  service = new TelegramService(
    settings,
    {} as ProductsService,
    {} as AnnouncementService,
    {} as OrdersService,
    {} as PaymentsService,
    {} as TelegramUsersService,
    {} as BalanceService,
    prisma as unknown as PrismaService,
    {} as StorefrontService,
  );

  const user = await prisma.user.create({
    data: {
      code: 810001,
      email: 'private-customer@example.test',
      passwordHash: 'x',
      telegramName: 'Private Customer (@private_customer)',
      telegramChatId: '810001',
    },
  });
  const product = await prisma.product.create({
    data: { slug: 'owner-alert-test', name: 'ChatGPT Test', active: true },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: '30 ngày',
      price: new Prisma.Decimal(4),
      priceCurrency: 'VND',
      priceAmount: new Prisma.Decimal(100_000),
      active: true,
    },
  });
  variantId = variant.id;
  await prisma.stockItem.create({
    data: { variantId, content: 'KEY-LOW-STOCK', status: 'AVAILABLE' },
  });

  makeOrder = async (code, createdAt, isStuck, overrides = {}) => {
    return prisma.order.create({
      data: {
        code,
        userId: user.id,
        status: overrides.status ?? 'PENDING',
        paidAt: overrides.paidAt,
        subtotalAmount: new Prisma.Decimal(4),
        totalAmount: new Prisma.Decimal(4),
        createdAt,
        telegramOwnerNewOrderNotifiedAt: isStuck ? new Date() : null,
        items: {
          create: {
            productId: product.id,
            variantId,
            productName: product.name,
            variantName: variant.name,
            unitPrice: new Prisma.Decimal(4),
            quantity: 1,
          },
        },
        payment: {
          create: {
            merchantTradeNo: `MT-${code}`,
            amount: new Prisma.Decimal(4),
            mode: overrides.mode ?? 'SEPAY',
            status: overrides.paymentStatus ?? 'PENDING',
            vndAmount: new Prisma.Decimal(100_000),
          },
        },
      },
    });
  };
  newOrderId = (await makeOrder('DH-NEW001', new Date(), false)).id;
  stuckOrderId = (
    await makeOrder('DH-STUCK1', new Date(Date.now() - 10 * 60_000), true)
  ).id;
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`,
    );
  } finally {
    await admin.$disconnect();
  }
}, 60_000);

describe('Telegram owner alerts (PostgreSQL thật)', () => {
  it('không báo đơn chờ; chỉ gửi tin ẩn danh sau thanh toán và không lộ vận hành vào nhóm', async (ctx) => {
    if (!reachable) {
      ctx.skip();
      return;
    }
    const payloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        payloads.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({ ok: true, result: { message_id: 1 } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }),
    );

    await (
      service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }
    ).notifyOwnerAlerts('token-test');

    expect(payloads).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({where:{id:newOrderId}})).telegramOwnerNewOrderNotifiedAt).toBeNull();
    const fulfillment = new FulfillmentService(prisma as unknown as PrismaService);
    await fulfillment.markPaidAndDeliver({orderId:newOrderId});
    await (service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }).notifyOwnerAlerts('token-test');
    expect(payloads).toHaveLength(1);
    expect(String(payloads[0].text)).toContain('Đã có khách hàng mua thành công');
    expect(String(payloads[0].text)).toContain('xxx');
    for(const privateValue of ['private-customer','@private_customer','Private Customer','DH-NEW001'])expect(String(payloads[0].text)).not.toContain(privateValue);
    expect(
      payloads.every((payload) => payload.chat_id === -1001234567890),
    ).toBe(true);

    const [newOrder, stuckOrder, variant] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: newOrderId } }),
      prisma.order.findUniqueOrThrow({ where: { id: stuckOrderId } }),
      prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } }),
    ]);
    expect(newOrder.telegramOwnerNewOrderNotifiedAt).not.toBeNull();
    expect(stuckOrder.telegramOwnerStuckNotifiedAt).toBeNull();
    expect(variant.telegramOwnerLowStockNotifiedAt).toBeNull();

    payloads.length = 0;
    await (
      service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }
    ).notifyOwnerAlerts('token-test');
    expect(payloads).toHaveLength(0);
    config.ownerChatId='123456789';
    await (service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }).notifyOwnerAlerts('token-test');
    expect(payloads).toHaveLength(2);
    expect(payloads.every(p=>p.chat_id===123456789)).toBe(true);
    expect(payloads.some(p=>String(p.text).includes('ĐƠN CHỜ QUÁ LÂU'))).toBe(true);
    expect(payloads.some(p=>String(p.text).includes('HẾT HÀNG'))).toBe(true);
    config.ownerStuckAlertsEnabled=false;
    config.ownerLowStockAlertsEnabled=false;
  }, 30_000);

  it('bỏ qua PENDING, EXPIRED, CANCELLED, mock, payment chưa SUCCESS và thiếu paidAt',async ctx=>{
    if(!reachable)return ctx.skip();
    const now=new Date();
    for(const status of ['PENDING','EXPIRED','CANCELLED'] as const)await makeOrder(`DH-${status}`,now,false,{status,paymentStatus:'SUCCESS',paidAt:now});
    await makeOrder('DH-MOCK',now,false,{status:'DELIVERED',paidAt:now,paymentStatus:'SUCCESS',mode:'MOCK'});
    await makeOrder('DH-NOPAY',now,false,{status:'PAID',paidAt:now});
    await makeOrder('DH-NOTIME',now,false,{status:'DELIVERED',paymentStatus:'SUCCESS'});
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await (service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }).notifyOwnerAlerts('token-test');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('PAID bằng số dư được báo một lần; lỗi gửi vẫn giữ marker cho lượt retry',async ctx=>{
    if(!reachable)return ctx.skip();
    const order=await makeOrder('DH-BALANCE',new Date(),false,{status:'PAID',paidAt:new Date(),paymentStatus:'SUCCESS',mode:'BALANCE'});
    const fetch=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(new Response(JSON.stringify({ok:true,result:{message_id:3}})));
    vi.stubGlobal('fetch',fetch);
    const run=()=> (service as unknown as { notifyOwnerAlerts(token: string): Promise<void> }).notifyOwnerAlerts('token-test');
    await expect(run()).rejects.toThrow('network');
    expect((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).telegramOwnerNewOrderNotifiedAt).toBeNull();
    await run();await run();expect(fetch).toHaveBeenCalledTimes(2);
    expect((await prisma.order.findUniqueOrThrow({where:{id:order.id}})).telegramOwnerNewOrderNotifiedAt).not.toBeNull();
  });
});
