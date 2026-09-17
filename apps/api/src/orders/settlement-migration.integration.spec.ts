import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const base = process.env.DATABASE_URL;
const migration = '20260917090000_payment_settlement_safety';
const migrations = resolve(__dirname, '../../prisma/migrations');
const created = new Map<string, PrismaClient>();
const timestamp = new Date('2026-01-02T03:04:05.000Z');

function client(database: string): PrismaClient {
  const url = new URL(base!);
  // CREATE/DROP chỉ nhắm database random trên cluster synthetic của runner, không fallback app.env.
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/review') {
    throw new Error('Run settlement migration tests with isolated run-db-command.mjs');
  }
  url.pathname = `/${database}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function apply(db: PrismaClient, folder: string): Promise<void> {
  const sql = readFileSync(join(migrations, folder, 'migration.sql'), 'utf8');
  // Chạy đúng SQL thật theo splitter hiện có; không bọc transaction để che partial migration.
  for (const statement of sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
}

async function legacyDatabase(): Promise<PrismaClient> {
  const name = `settlement_migration_${randomUUID().replaceAll('-', '')}`;
  const bootstrap = client('postgres');
  try {
    await bootstrap.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await bootstrap.$disconnect();
  }
  const db = client(name);
  created.set(name, db);
  const folders = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < migration)
    .map((entry) => entry.name).sort();
  for (const folder of folders) await apply(db, folder);
  // Raw SQL không dựa vào generated client mới: đây là dữ liệu trước sessionVersion/claim/FK mới.
  await db.$executeRaw`
    INSERT INTO "User" (id, code, email, "passwordHash", balance, "createdAt")
    VALUES ('legacy-user', 99000111, 'legacy@test.local', 'synthetic', 7.654321, ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "BalanceEntry" (id, "userId", amount, "balanceAfter", reason, "refCode", "createdAt")
    VALUES ('legacy-ledger', 'legacy-user', 7.654321, 7.654321, 'admin', 'TEST-LEGACY', ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "Product" (id, slug, name, "createdAt", "updatedAt")
    VALUES ('legacy-product', 'test-legacy-product', 'TEST legacy product', ${timestamp}, ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "ProductVariant" (id, "productId", name, price, "priceCurrency", "priceAmount", "createdAt", "updatedAt") VALUES
    ('legacy-stock-variant', 'legacy-product', 'Stock only', 3.846153, 'VND', 100000, ${timestamp}, ${timestamp}),
    ('legacy-history-variant', 'legacy-product', 'History only', 3.846153, 'VND', 100000, ${timestamp}, ${timestamp}),
    ('legacy-assigned-variant', 'legacy-product', 'Assigned stock', 3.846153, 'VND', 100000, ${timestamp}, ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "Order" (id, code, "userId", status, "subtotalAmount", "totalAmount", "createdAt")
    VALUES ('legacy-order', 'TEST-LEGACY-ORDER', 'legacy-user', 'DELIVERED', 11.538459, 11.538459, ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "OrderItem" (id, "orderId", "productId", "variantId", "productName", "variantName", "unitPrice", quantity) VALUES
    ('legacy-history-item', 'legacy-order', 'legacy-product', 'legacy-history-variant', 'Snapshot product', 'Snapshot history', 3.846153, 1),
    ('legacy-null-item', 'legacy-order', 'legacy-product', NULL, 'Snapshot deleted', 'Old null variant', 3.846153, 1),
    ('legacy-assigned-item', 'legacy-order', 'legacy-product', 'legacy-assigned-variant', 'Snapshot product', 'Assigned', 3.846153, 1)
  `;
  await db.$executeRaw`
    INSERT INTO "StockItem" (id, "variantId", content, status, "orderItemId", "createdAt", "soldAt", "withdrawnAt") VALUES
    ('legacy-available', 'legacy-stock-variant', '9007199254740993', 'AVAILABLE', NULL, ${timestamp}, NULL, NULL),
    ('legacy-withdrawn', 'legacy-stock-variant', 'TEST-WITHDRAWN', 'WITHDRAWN', NULL, ${timestamp}, NULL, ${timestamp}),
    ('legacy-reserved', 'legacy-assigned-variant', '{"accounts":[{"id":"TEST-RESERVED"}],"proxies":[]}', 'RESERVED', 'legacy-assigned-item', ${timestamp}, NULL, NULL),
    ('legacy-sold', 'legacy-assigned-variant', 'TEST-SOLD-KEEP', 'SOLD', 'legacy-assigned-item', ${timestamp}, ${timestamp}, NULL)
  `;
  return db;
}

interface LegacyPayment {
  id: string;
  mode: string;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
  network?: string;
  reference?: string;
  sepayRef?: string;
  amount?: string;
  cryptoAmount?: string;
  vndAmount?: string;
}

async function payment(db: PrismaClient, fixture: LegacyPayment) {
  const orderId = `order-${fixture.id}`;
  const status = fixture.status ?? 'SUCCESS';
  await db.$executeRaw`
    INSERT INTO "Order" (id, code, "userId", status, "totalAmount", "createdAt")
    VALUES (${orderId}, ${`TEST-${fixture.id}`}, 'legacy-user',
      ${status === 'FAILED' ? 'CANCELLED' : status === 'EXPIRED' ? 'EXPIRED' : status === 'SUCCESS' ? 'DELIVERED' : 'PENDING'}::"OrderStatus",
      ${fixture.amount ?? '3.846153'}::numeric, ${timestamp})
  `;
  await db.$executeRaw`
    INSERT INTO "Payment" (id, "orderId", mode, status, "merchantTradeNo", amount,
      "cryptoNetwork", "cryptoTxId", "cryptoAddress", "cryptoAmount", "sepayRef", "vndAmount", "createdAt", "updatedAt")
    VALUES (${fixture.id}, ${orderId}, ${fixture.mode}, ${status}::"PaymentStatus", ${`merchant-${fixture.id}`},
      ${fixture.amount ?? '3.846153'}::numeric, ${fixture.network ?? null}, ${fixture.reference ?? null}, 'TEST-RECEIVER',
      ${fixture.cryptoAmount ?? null}::numeric, ${fixture.sepayRef ?? null}, ${fixture.vndAmount ?? null}::numeric, ${timestamp}, ${timestamp})
  `;
}

interface LegacyDeposit {
  id: string;
  mode: 'CRYPTO' | 'BINANCE_ID' | 'SEPAY';
  status?: 'PENDING' | 'SUCCESS' | 'CANCELLED' | 'EXPIRED';
  network?: string;
  reference?: string;
  sepayRef?: string;
}

async function deposit(db: PrismaClient, fixture: LegacyDeposit) {
  await db.$executeRaw`
    INSERT INTO "Deposit" (id, code, "userId", mode, status, "amountUsdt", "vndAmount", "cryptoNetwork", "cryptoTxId",
      "cryptoAddress", "sepayRef", "createdAt", "expiresAt")
    VALUES (${fixture.id}, ${`TEST-${fixture.id}`}, 'legacy-user', ${fixture.mode}::"DepositMode", ${fixture.status ?? 'SUCCESS'}::"DepositStatus",
      2.345678, 61000, ${fixture.network ?? null}, ${fixture.reference ?? null}, 'TEST-DEPOSIT-RECEIVER', ${fixture.sepayRef ?? null},
      ${timestamp}, ${new Date('2026-01-03T03:04:05.000Z')})
  `;
}

async function snapshot(db: PrismaClient) {
  const result: Record<string, unknown[]> = {};
  for (const table of ['User', 'BalanceEntry', 'Product', 'ProductVariant', 'Order', 'OrderItem', 'StockItem', 'Payment', 'Deposit']) {
    // Chỉ bỏ cột mới đúng bảng; Payment.sepayBank đã có từ trước vẫn phải so sánh.
    const projection = table === 'Payment' ? "to_jsonb(t) - 'sessionVersion'"
      : table === 'Deposit' ? "to_jsonb(t) - 'sepayBank' - 'sepayAccountHolder'" : 'to_jsonb(t)';
    result[table] = await db.$queryRawUnsafe(`SELECT ${projection} AS row FROM "${table}" t ORDER BY id`);
  }
  return result;
}

async function expectMigrationFailure(db: PrismaClient, code: '23505' | '23514') {
  const before = await snapshot(db);
  await expect(apply(db, migration)).rejects.toMatchObject({ code: 'P2010', meta: { code } });
  expect(await snapshot(db)).toEqual(before);
}

afterAll(async () => {
  if (!created.size) return;
  const bootstrap = client('postgres');
  try {
    for (const [name, db] of created) {
      await db.$disconnect();
      await bootstrap.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await bootstrap.$disconnect();
  }
}, 60_000);

describe.skipIf(!base)('settlement migration upgrades isolated legacy PostgreSQL', () => {
  it('preserves stock, order snapshots, balances and all historical reference namespaces', async () => {
    const db = await legacyDatabase();
    await payment(db, { id: 'pay-chain', mode: 'CRYPTO', network: 'BEP20', reference: ' 0xAbC123 ', cryptoAmount: '3.846199' });
    await payment(db, { id: 'pay-cancelled', mode: 'BINANCE_ID', status: 'FAILED', reference: ' PayCase-001 ' });
    await payment(db, { id: 'pay-sepay', mode: 'SEPAY', status: 'FAILED', sepayRef: ' SEPAY-P-01 ', vndAmount: '100000' });
    await payment(db, { id: 'pay-merchant', mode: 'BINANCE', amount: '6.123456' });
    await payment(db, { id: 'pay-merchant-expired', mode: 'BINANCE', status: 'EXPIRED' });
    await payment(db, { id: 'pay-no-reference', mode: 'MOCK', status: 'PENDING' });
    await deposit(db, { id: 'deposit-cancelled', mode: 'CRYPTO', status: 'CANCELLED', network: 'TRC20', reference: ' AbCdEf001 ' });
    await deposit(db, { id: 'deposit-pay', mode: 'BINANCE_ID', reference: ' BinanceCase-X ' });
    await deposit(db, { id: 'deposit-sepay', mode: 'SEPAY', status: 'EXPIRED', sepayRef: ' SEPAY-D-01 ' });
    const before = await snapshot(db);
    expect(Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length]))).toEqual({
      User: 1, BalanceEntry: 1, Product: 1, ProductVariant: 3, Order: 7, OrderItem: 3, StockItem: 4, Payment: 6, Deposit: 3,
    });

    await apply(db, migration);

    expect(await snapshot(db)).toEqual(before);
    const claims = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT source, reference, amount::text, currency, network, receiver, status, "paymentId", "depositId"
      FROM "IncomingTransfer" ORDER BY source, reference
    `;
    expect(claims).toEqual([
      { source: 'BINANCE_ID', reference: 'BinanceCase-X', amount: '2.345678', currency: 'USDT', network: null, receiver: 'TEST-DEPOSIT-RECEIVER', status: 'CLAIMED', paymentId: null, depositId: 'deposit-pay' },
      { source: 'BINANCE_ID', reference: 'PayCase-001', amount: '3.846153', currency: 'USDT', network: null, receiver: 'TEST-RECEIVER', status: 'CLAIMED', paymentId: 'pay-cancelled', depositId: null },
      { source: 'BINANCE_MERCHANT', reference: 'merchant-pay-merchant', amount: '6.123456', currency: 'USDT', network: null, receiver: null, status: 'CLAIMED', paymentId: 'pay-merchant', depositId: null },
      { source: 'CRYPTO:BEP20', reference: '0xabc123', amount: '3.846199', currency: 'USDT', network: 'BEP20', receiver: 'TEST-RECEIVER', status: 'CLAIMED', paymentId: 'pay-chain', depositId: null },
      { source: 'CRYPTO:TRC20', reference: 'abcdef001', amount: '2.345678', currency: 'USDT', network: 'TRC20', receiver: 'TEST-DEPOSIT-RECEIVER', status: 'CLAIMED', paymentId: null, depositId: 'deposit-cancelled' },
      { source: 'SEPAY', reference: 'SEPAY-D-01', amount: '61000.000000', currency: 'VND', network: null, receiver: null, status: 'CLAIMED', paymentId: null, depositId: 'deposit-sepay' },
      { source: 'SEPAY', reference: 'SEPAY-P-01', amount: '100000.000000', currency: 'VND', network: null, receiver: 'TEST-RECEIVER', status: 'CLAIMED', paymentId: 'pay-sepay', depositId: null },
    ]);
    expect(await db.$queryRaw`SELECT "merchantTradeNo", "paymentId" FROM "MerchantPaymentSession" ORDER BY "merchantTradeNo"`).toEqual([
      { merchantTradeNo: 'merchant-pay-merchant', paymentId: 'pay-merchant' },
      { merchantTradeNo: 'merchant-pay-merchant-expired', paymentId: 'pay-merchant-expired' },
    ]);
    expect(await db.$queryRaw`
      SELECT "paymentId", "sessionVersion", mode, amount::text, network, receiver
      FROM "PaymentInstruction" ORDER BY "paymentId"
    `).toEqual([
      { paymentId: 'pay-cancelled', sessionVersion: 0, mode: 'BINANCE_ID', amount: '3.846153', network: null, receiver: 'TEST-RECEIVER' },
      { paymentId: 'pay-chain', sessionVersion: 0, mode: 'CRYPTO', amount: '3.846199', network: 'BEP20', receiver: 'TEST-RECEIVER' },
      { paymentId: 'pay-sepay', sessionVersion: 0, mode: 'SEPAY', amount: '100000.000000', network: null, receiver: 'TEST-RECEIVER' },
    ]);
    expect(await db.$queryRaw`SELECT "sepayBank", "sepayAccountHolder" FROM "Deposit" WHERE id = 'deposit-sepay'`).toEqual([{ sepayBank: null, sepayAccountHolder: null }]);
    expect(await db.$queryRaw`SELECT "sessionVersion" FROM "Payment" WHERE id = 'pay-chain'`).toEqual([{ sessionVersion: 0 }]);
    // Hủy không trả lại quyền claim reference lịch sử cho đơn/mã nạp khác.
    await expect(db.$executeRaw`DELETE FROM "Payment" WHERE id = 'pay-cancelled'`).rejects.toMatchObject({ meta: { code: '23503' } });
    await expect(db.$executeRaw`DELETE FROM "Deposit" WHERE id = 'deposit-cancelled'`).rejects.toMatchObject({ meta: { code: '23503' } });
    expect(await snapshot(db)).toEqual(before);
  }, 120_000);

  it.each(['BEP20', 'TRC20'])('fails closed for case-normalized %s references reused across payment and deposit', async (network) => {
    const db = await legacyDatabase();
    await payment(db, { id: 'collision-payment', mode: 'CRYPTO', status: 'FAILED', network, reference: ' 0xAbCdEf123 ' });
    await deposit(db, { id: 'collision-deposit', mode: 'CRYPTO', status: 'CANCELLED', network, reference: '0xabcdef123' });
    await expectMigrationFailure(db, '23505');
  }, 120_000);

  it('keeps equal reference text in separate chain namespaces', async () => {
    const db = await legacyDatabase();
    await payment(db, { id: 'different-payment', mode: 'CRYPTO', network: 'BEP20', reference: ' AbCd123 ' });
    await deposit(db, { id: 'different-deposit', mode: 'CRYPTO', network: 'TRC20', reference: 'abcd123' });
    const before = await snapshot(db);
    await apply(db, migration);
    expect(await db.$queryRaw`SELECT source, reference FROM "IncomingTransfer" ORDER BY source`).toEqual([
      { source: 'CRYPTO:BEP20', reference: 'abcd123' },
      { source: 'CRYPTO:TRC20', reference: 'abcd123' },
    ]);
    expect(await snapshot(db)).toEqual(before);
  }, 120_000);

  it.each(['payment', 'deposit'] as const)('fails closed for an unknown %s crypto namespace without changing historical data', async (target) => {
    const db = await legacyDatabase();
    if (target === 'payment') {
      await payment(db, { id: 'unknown-payment', mode: 'CRYPTO', status: 'FAILED', network: 'UNKNOWN-NETWORK', reference: 'TEST-UNKNOWN' });
    } else {
      await deposit(db, { id: 'unknown-deposit', mode: 'CRYPTO', status: 'CANCELLED', reference: 'TEST-UNKNOWN' });
    }
    await expectMigrationFailure(db, '23514');
  }, 120_000);

  it('changes destructive legacy variant deletes into RESTRICT while preserving existing null history', async () => {
    const db = await legacyDatabase();
    const before = await snapshot(db);
    // Baseline chạy thật rồi rollback fixture: schema cũ xóa key hoặc gỡ variant khỏi lịch sử.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "ProductVariant" WHERE id = 'legacy-stock-variant'`;
      expect(await tx.$queryRaw`SELECT id FROM "StockItem" WHERE "variantId" = 'legacy-stock-variant'`).toEqual([]);
      await tx.$executeRaw`DELETE FROM "ProductVariant" WHERE id = 'legacy-history-variant'`;
      expect(await tx.$queryRaw`SELECT "variantId" FROM "OrderItem" WHERE id = 'legacy-history-item'`).toEqual([{ variantId: null }]);
      throw new Error('rollback legacy delete probe');
    })).rejects.toThrow('rollback legacy delete probe');
    expect(await snapshot(db)).toEqual(before);

    await apply(db, migration);

    await expect(db.$executeRaw`DELETE FROM "ProductVariant" WHERE id = 'legacy-stock-variant'`).rejects.toMatchObject({ meta: { code: '23503' } });
    await expect(db.$executeRaw`DELETE FROM "ProductVariant" WHERE id = 'legacy-history-variant'`).rejects.toMatchObject({ meta: { code: '23503' } });
    expect(await db.$queryRaw`SELECT "variantId" FROM "OrderItem" WHERE id = 'legacy-null-item'`).toEqual([{ variantId: null }]);
    expect(await snapshot(db)).toEqual(before);
  }, 120_000);
});
