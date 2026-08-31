import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { BinanceService } from '../payments/binance.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { FulfillmentService } from './fulfillment.service';
import { OrdersService } from './orders.service';

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_telegram_order_idempotency_test';

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
let service: OrdersService;
let userId = '';
let variantId = '';

beforeAll(async () => {
  const probe = newClient('postgres');
  try {
    await probe.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    // Suite tự skip khi PostgreSQL nhúng chưa chạy, giống các integration khác.
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
  const fulfillment = new FulfillmentService(
    prisma as unknown as PrismaService,
  );
  const settings = {
    getEnabledMethods: async () => [{ method: 'sepay', accountHolder: 'CATT' }],
    getTelegramConfig: async () => ({
      enabled: true,
      token: 'token-test',
      ownerChatId: '123456789',
      ownerOrderAlertsEnabled: true,
    }),
    getSepayConfig: async () => ({
      ready: true,
      accountNumber: '007',
      bank: 'MB',
      accountHolder: 'CATT',
      vndPerUsdt: 26_000,
    }),
  } as unknown as SettingsService;
  const config = {
    get: (key: string) =>
      key === 'ORDER_EXPIRE_MINUTES'
        ? '30'
        : key === 'SEPAY_EXPIRE_MINUTES'
          ? '10'
          : undefined,
  } as unknown as ConfigService;
  service = new OrdersService(
    prisma as unknown as PrismaService,
    config,
    fulfillment,
    {} as BinanceService,
    {} as BinanceExchangeService,
    settings,
    {} as CouponsService,
  );

  const user = await prisma.user.create({
    data: {
      code: 700001,
      email: null,
      passwordHash: 'x',
      telegramChatId: '700001',
      telegramName: 'Khách test',
    },
  });
  userId = user.id;
  const product = await prisma.product.create({
    data: { slug: 'telegram-idempotency', name: 'Sản phẩm test', active: true },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: 'Loại test',
      price: new Prisma.Decimal(2),
      priceCurrency: 'USDT',
      priceAmount: new Prisma.Decimal(2),
      active: true,
    },
  });
  variantId = variant.id;
  await prisma.stockItem.create({
    data: { variantId, content: 'KEY-IDEMPOTENCY', status: 'AVAILABLE' },
  });
}, 120_000);

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

describe('OrdersService Telegram idempotency (PostgreSQL thật)', () => {
  it('hai tiến trình nhận cùng callback chỉ giữ một key và tạo một đơn', async (ctx) => {
    if (!reachable) {
      ctx.skip();
      return;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const callback = 'callback-order-001';
    const [a, b] = await Promise.all([
      service.create(
        user,
        { items: [{ variantId, quantity: 1 }] },
        { telegramCallbackId: callback },
      ),
      service.create(
        user,
        { items: [{ variantId, quantity: 1 }] },
        { telegramCallbackId: callback },
      ),
    ]);

    expect(a.order.code).toBe(b.order.code);
    expect(a.payment.mode).toBe('SEPAY');
    expect(b.payment.mode).toBe('SEPAY');
    expect(
      await prisma.order.count({ where: { telegramCallbackId: callback } }),
    ).toBe(1);
    expect(
      await prisma.stockItem.count({ where: { status: 'RESERVED' } }),
    ).toBe(1);
    expect(
      await prisma.stockItem.count({ where: { status: 'AVAILABLE' } }),
    ).toBe(0);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { orderId: a.order.id },
    });
    expect(payment.mode).toBe('SEPAY');
  }, 30_000);
});
