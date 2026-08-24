import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FulfillmentService } from '../orders/fulfillment.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { BalanceService } from './balance.service';

/**
 * Test TÍCH HỢP tiền ví trên PostgreSQL thật — theo khuôn
 * fulfillment.integration.spec. Đây là TIỀN: trừ hai lần cho một cú bấm đúp,
 * hay cộng hai lần cho một webhook trùng, đều là mất tiền thật; mock sẽ "đạt"
 * mọi test kể cả khi bỏ hết khoá và guard.
 *
 * Suite tự BỎ QUA khi không có PostgreSQL (chưa chạy `pnpm db:embedded`).
 */

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_balance_test';

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

async function isPostgresReachable(): Promise<boolean> {
  const admin = newClient('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

let reachable = false;
let prisma: PrismaClient;
let service: BalanceService;

function itDb(name: string, fn: () => Promise<void>, timeout?: number): void {
  it(
    name,
    async (ctx) => {
      if (!reachable) {
        ctx.skip();
        return;
      }
      await fn();
    },
    timeout,
  );
}

async function applyMigrations(client: PrismaClient): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await client.$executeRawUnsafe(statement);
    }
  }
}

/** SettingsService giả — BalanceService chỉ gọi getSepayConfig khi TẠO mã nạp. */
const settingsStub = {
  getSepayConfig: async () => ({
    ready: true,
    accountNumber: '007',
    bank: 'Vietcombank',
    accountHolder: 'NGUYEN VAN A',
    vndPerUsdt: 26_000,
    apiKey: 'x',
    webhookSecret: '',
  }),
} as unknown as SettingsService;

let userId: string;
let variantId: string;

/** Một đơn PENDING 2 USDT kèm payment PENDING và 1 key trong kho. */
async function taoDonPending(code: string): Promise<string> {
  await prisma.stockItem.create({
    data: { variantId, content: `KEY-${code}`, status: 'AVAILABLE' },
  });
  const order = await prisma.order.create({
    data: {
      code,
      userId,
      status: 'PENDING',
      subtotalAmount: new Prisma.Decimal(2),
      totalAmount: new Prisma.Decimal(2),
      items: {
        create: {
          productId: (await prisma.productVariant.findUniqueOrThrow({
            where: { id: variantId },
            select: { productId: true },
          })).productId,
          variantId,
          productName: 'SP Test',
          variantName: 'Loại 1',
          unitPrice: new Prisma.Decimal(2),
          quantity: 1,
        },
      },
      payment: {
        create: {
          merchantTradeNo: `MT${code.replace(/-/g, '')}`,
          amount: new Prisma.Decimal(2),
          mode: 'SEPAY',
          status: 'PENDING',
        },
      },
    },
  });
  return order.id;
}

beforeAll(async () => {
  reachable = await isPostgresReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `[balance] Bỏ qua test tích hợp: không kết nối được PostgreSQL tại ${
        new URL(BASE_URL).host
      }. Chạy "pnpm db:embedded" rồi thử lại.`,
    );
    return;
  }
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.$disconnect();
  }
  prisma = newClient(TEST_DB);
  await applyMigrations(prisma);
  service = new BalanceService(
    prisma as unknown as PrismaService,
    settingsStub,
    new FulfillmentService(prisma as unknown as PrismaService),
  );

  const user = await prisma.user.create({
    data: {
      code: 100001,
      email: null,
      passwordHash: 'x',
      telegramChatId: '111',
      telegramName: 'Test',
    },
  });
  userId = user.id;
  const product = await prisma.product.create({
    data: { slug: 'sp-test', name: 'SP Test', active: true },
  });
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: 'Loại 1',
      price: new Prisma.Decimal(2),
      priceCurrency: 'USDT',
      priceAmount: new Prisma.Decimal(2),
      active: true,
    },
  });
  variantId = variant.id;
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
});

describe('BalanceService (tích hợp — tiền thật, chạy trên PG thật)', () => {
  itDb('tạo mã nạp: USDT làm tròn XUỐNG theo tỉ giá lúc tạo, chặn số tiền lạ', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const kq = await service.createDeposit(user, 100_000);
    // 100000 / 26000 = 3.846153846… → floor về 6 chữ số
    expect(Number(kq.deposit.amountUsdt)).toBe(3.846153);
    expect(kq.deposit.code.startsWith('NAP-')).toBe(true);
    expect(kq.accountNumber).toBe('007');

    await expect(service.createDeposit(user, 5_000)).rejects.toThrow();
    await expect(service.createDeposit(user, 123.45 as unknown as number)).rejects.toThrow();
  });

  itDb('cộng ví đúng MỘT lần dù webhook trùng/đua nhau; sổ cái khớp', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { deposit } = await service.createDeposit(user, 260_000); // = 10 USDT

    const [a, b] = await Promise.all([
      service.creditDeposit(deposit.id, 'ref-1'),
      service.creditDeposit(deposit.id, 'ref-1-song-song'),
    ]);
    // Đúng một bên thắng — bên nào không quan trọng.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // Webhook gửi lại lần nữa cũng không cộng thêm.
    expect(await service.creditDeposit(deposit.id, 'ref-2')).toBe(false);

    const sau = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(sau.balance)).toBe(10);
    const entries = await prisma.balanceEntry.findMany({
      where: { userId, refCode: deposit.code },
    });
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].amount)).toBe(10);
    expect(Number(entries[0].balanceAfter)).toBe(10);
  });

  itDb('trả đơn bằng số dư: trừ đúng một lần, đơn giao, payment mode BALANCE', async () => {
    const orderId = await taoDonPending('DH-BAL001');
    const kq = await service.payOrderWithBalance(userId, 'DH-BAL001');
    expect(kq.delivered).toBe(true);

    const [user, order, payment, entries] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.payment.findUniqueOrThrow({ where: { orderId } }),
      prisma.balanceEntry.findMany({ where: { userId, refCode: 'DH-BAL001' } }),
    ]);
    expect(Number(user.balance)).toBe(8); // 10 − 2
    expect(order.status).toBe('DELIVERED');
    expect(payment.mode).toBe('BALANCE');
    expect(payment.status).toBe('SUCCESS');
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].amount)).toBe(-2);
    expect(Number(entries[0].balanceAfter)).toBe(8);
  });

  itDb('bấm đúp "trả bằng số dư" → chỉ trừ MỘT lần', async () => {
    await taoDonPending('DH-BAL002');
    const kqs = await Promise.allSettled([
      service.payOrderWithBalance(userId, 'DH-BAL002'),
      service.payOrderWithBalance(userId, 'DH-BAL002'),
    ]);
    expect(kqs.filter((k) => k.status === 'fulfilled')).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(user.balance)).toBe(6); // 8 − 2, KHÔNG phải 4
    expect(
      await prisma.balanceEntry.count({ where: { userId, refCode: 'DH-BAL002' } }),
    ).toBe(1);
  });

  itDb('số dư không đủ → LĂN NGƯỢC cả giao dịch: đơn về PENDING, ví nguyên vẹn', async () => {
    // Ví còn 6 USDT — dựng đơn 2 USDT rồi rút ví xuống 1 để thiếu tiền.
    const orderId = await taoDonPending('DH-BAL003');
    await prisma.user.update({
      where: { id: userId },
      data: { balance: new Prisma.Decimal(1) },
    });

    await expect(
      service.payOrderWithBalance(userId, 'DH-BAL003'),
    ).rejects.toThrow(BadRequestException);

    const [user, order] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
    ]);
    expect(Number(user.balance)).toBe(1); // không bị trừ
    expect(order.status).toBe('PENDING'); // gate đã hoàn tác
    expect(
      await prisma.balanceEntry.count({ where: { userId, refCode: 'DH-BAL003' } }),
    ).toBe(0);
  });

  itDb('đơn của người khác → không trả được bằng ví của mình', async () => {
    await expect(
      service.payOrderWithBalance('user-khong-ton-tai', 'DH-BAL003'),
    ).rejects.toThrow();
  });
});
