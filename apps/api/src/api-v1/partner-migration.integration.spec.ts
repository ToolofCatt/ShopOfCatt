import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Chỉ dùng PG opt-in và tạo database riêng; không đọc DATABASE_URL/.env, không
// migrate/cleanup database trong URL caller (có thể đang phục vụ suite khác).
const baseUrl = process.env.PARTNER_TRANSACTION_TEST_DATABASE_URL;
const database = `partner_upgrade_${randomUUID().replaceAll('-', '')}`;
const partnerMigration = '20260918090000_partner_api';
const directory = resolve(__dirname, '../../prisma/migrations');

function client(name: string): PrismaClient {
  const url = new URL(baseUrl!);
  url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function applyMigration(db: PrismaClient, name: string): Promise<void> {
  const sql = readFileSync(join(directory, name, 'migration.sql'), 'utf8');
  // Cùng runner SQL với các suite PG hiện có; lịch sử hiện tại chỉ có DDL/DML
  // statement thường, không function body/dollar quote chứa dấu chấm phẩy.
  for (const statement of sql.split(/\r?\n/).filter(line => !line.trim().startsWith('--')).join('\n').split(';').map(part => part.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
}

async function historicSnapshot(db: PrismaClient) {
  // Lấy toàn bộ cột scalar, không chỉ counts: key, số tiền sáu chữ số, receiver,
  // callback và mốc thời gian đều là lịch sử không được rewrite khi nâng cấp.
  const rows = await Promise.all([
    db.user.findMany({ orderBy: { id: 'asc' } }),
    db.product.findMany({ orderBy: { id: 'asc' } }),
    db.productVariant.findMany({ orderBy: { id: 'asc' } }),
    db.order.findMany({ orderBy: { id: 'asc' } }),
    db.orderItem.findMany({ orderBy: { id: 'asc' } }),
    db.payment.findMany({ orderBy: { id: 'asc' } }),
    db.stockItem.findMany({ orderBy: { id: 'asc' } }),
    db.deposit.findMany({ orderBy: { id: 'asc' } }),
    db.balanceEntry.findMany({ orderBy: { id: 'asc' } }),
    db.incomingTransfer.findMany({ orderBy: { id: 'asc' } }),
  ]);
  // Prisma.Decimal.toJSON giữ chuỗi chính xác, không đưa tiền qua JS Number.
  return JSON.stringify(rows);
}

async function historicalFixture(db: PrismaClient): Promise<void> {
  const createdAt = new Date('2026-09-01T08:00:00.123Z');
  const paidAt = new Date('2026-09-01T08:01:00.456Z');
  const expiresAt = new Date('2026-09-01T08:30:00.123Z');
  await db.user.createMany({ data: [
    { id: 'history-buyer', code: 81000001, email: 'history@example.invalid', passwordHash: 'synthetic-not-a-login', balance: '18.123455', createdAt },
    { id: 'history-telegram', code: 81000002, passwordHash: 'synthetic-not-a-login', telegramChatId: 'synthetic-chat', telegramName: 'Fixture', telegramLang: 'zh', lockedAt: paidAt, createdAt },
    { id: 'history-admin', code: 81000003, passwordHash: 'synthetic-not-a-login', role: 'SUPERADMIN', createdAt },
  ] });
  await db.product.create({ data: { id: 'history-product', name: 'Synthetic history', slug: 'synthetic-history', createdAt } });
  await db.productVariant.create({ data: { id: 'history-variant', productId: 'history-product', name: 'Default', price: '2.000001', priceAmount: '2', createdAt } });
  for (const status of ['PENDING', 'PAID', 'DELIVERED', 'CANCELLED', 'EXPIRED'] as const) {
    await db.order.create({ data: {
      id: `history-order-${status}`, code: `DH-HISTORY-${status}`, userId: 'history-buyer', status,
      subtotalAmount: '2.000001', totalAmount: '2.000001', createdAt, expiresAt,
      paidAt: status === 'PAID' || status === 'DELIVERED' ? paidAt : null,
      telegramCallbackId: `historic-callback-${status}`,
    } });
    await db.orderItem.create({ data: { id: `history-item-${status}`, orderId: `history-order-${status}`, productId: 'history-product', variantId: 'history-variant', productName: 'Name at purchase', variantName: 'Variant at purchase', unitPrice: '2.000001', quantity: 1 } });
  }
  await db.payment.create({ data: { id: 'history-payment', orderId: 'history-order-DELIVERED', mode: 'BALANCE', merchantTradeNo: 'synthetic-historic-trade', amount: '2.000001', status: 'SUCCESS', createdAt } });
  await db.stockItem.createMany({ data: [
    { id: 'history-stock-available', variantId: 'history-variant', content: 'SYNTHETIC-AVAILABLE-NOT-A-KEY', status: 'AVAILABLE', createdAt },
    { id: 'history-stock-reserved', variantId: 'history-variant', content: 'SYNTHETIC-RESERVED-NOT-A-KEY', status: 'RESERVED', orderItemId: 'history-item-PENDING', createdAt },
    { id: 'history-stock-sold', variantId: 'history-variant', content: 'SYNTHETIC-SOLD-NOT-A-KEY', status: 'SOLD', orderItemId: 'history-item-DELIVERED', soldAt: paidAt, createdAt },
    { id: 'history-stock-withdrawn', variantId: 'history-variant', content: 'SYNTHETIC-WITHDRAWN-NOT-A-KEY', status: 'WITHDRAWN', withdrawnAt: paidAt, createdAt },
  ] });
  await db.deposit.createMany({ data: [
    { id: 'history-deposit-paid', code: 'NAP-HISTORY-PAID', userId: 'history-buyer', status: 'SUCCESS', mode: 'SEPAY', amountUsdt: '20.123456', vndAmount: '523210', cryptoAddress: 'synthetic-old-account', sepayBank: 'Fixture Bank', sepayAccountHolder: 'Historic Receiver', sepayRef: 'synthetic-bank-ref', telegramCallbackId: 'historic-deposit-callback', paidAt, createdAt, expiresAt },
    { id: 'history-deposit-pending', code: 'NAP-HISTORY-PENDING', userId: 'history-buyer', status: 'PENDING', mode: 'CRYPTO', amountUsdt: '1.000123', vndAmount: '26000', cryptoNetwork: 'BEP20', cryptoAddress: 'synthetic-old-wallet', createdAt, expiresAt },
    { id: 'history-deposit-expired', code: 'NAP-HISTORY-EXPIRED', userId: 'history-telegram', status: 'EXPIRED', mode: 'BINANCE_ID', amountUsdt: '3.000456', vndAmount: '78000', cryptoAddress: 'synthetic-old-binance-id', createdAt, expiresAt },
  ] });
  await db.balanceEntry.createMany({ data: [
    { id: 'history-ledger-credit', userId: 'history-buyer', amount: '20.123456', balanceAfter: '20.123456', reason: 'deposit', refCode: 'NAP-HISTORY-PAID', createdAt },
    { id: 'history-ledger-debit', userId: 'history-buyer', amount: '-2.000001', balanceAfter: '18.123455', reason: 'purchase', refCode: 'DH-HISTORY-DELIVERED', createdAt: paidAt },
  ] });
  await db.incomingTransfer.create({ data: { id: 'history-transfer', source: 'SEPAY', reference: 'synthetic-bank-ref', amount: '523210', currency: 'VND', receiver: 'synthetic-old-account', status: 'CLAIMED', depositId: 'history-deposit-paid', receivedAt: paidAt, createdAt } });
}

describe.skipIf(!baseUrl)('partner migration upgrade / isolated PostgreSQL', () => {
  let db: PrismaClient;
  let created = false;
  let before: string;
  let after: string;
  let initialCounts: number[];

  beforeAll(async () => {
    const admin = client('postgres');
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      created = true;
    } finally { await admin.$disconnect(); }
    db = client(database);
    const migrations = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    if (!migrations.includes(partnerMigration)) throw new Error('Partner migration is missing');
    for (const name of migrations.filter(name => name < partnerMigration)) await applyMigration(db, name);
    await historicalFixture(db);
    before = await historicSnapshot(db);
    await applyMigration(db, partnerMigration);
    after = await historicSnapshot(db);
    initialCounts = await Promise.all([db.apiAccess.count(), db.apiKey.count(), db.apiOperationReceipt.count(), db.apiRateBucket.count()]);
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    if (!created) return;
    const admin = client('postgres');
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
      const [row] = await admin.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_database WHERE datname = ${database}`;
      expect(row.count).toBe(0n);
    } finally { await admin.$disconnect(); }
  }, 30_000);

  it('preserves every historic row and exact wallet/ledger amounts on upgrade', async () => {
    expect(after).toBe(before);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'history-buyer' } })).balance.toFixed(6)).toBe('18.123455');
    expect((await db.balanceEntry.aggregate({ where: { userId: 'history-buyer' }, _sum: { amount: true } }))._sum.amount?.toFixed(6)).toBe('18.123455');
    expect(await db.stockItem.count()).toBe(4);
  });

  it('creates no approvals, keys or receipts for existing accounts, including SUPERADMIN', async () => {
    expect(initialCounts).toEqual([0, 0, 0, 0]);
    const user = await db.user.findUniqueOrThrow({ where: { id: 'history-admin' }, include: { apiAccess: true, apiKeys: true } });
    expect(user.apiAccess).toBeNull();
    expect(user.apiKeys).toEqual([]);
    const access = await db.apiAccess.create({ data: { userId: 'history-admin' } });
    expect(access.enabled).toBe(false);
    expect(access.approvedAt).toBeNull();
    expect(access.approvedById).toBeNull();
  });

  it('retains key/approval/receipt evidence with the new foreign-key RESTRICT constraints', async () => {
    // Từng owner không có quan hệ cũ chặn DELETE thay: phải chứng minh chính FK
    // mới từ chối, không nhận nhầm lỗi của Order/BalanceEntry có sẵn.
    for (const [index, id] of ['access-only', 'key-only', 'receipt-only', 'resource-owner'].entries()) {
      await db.user.create({ data: { id, code: 81000100 + index, passwordHash: 'synthetic-not-a-login' } });
    }
    await db.apiAccess.create({ data: { userId: 'access-only' } });
    await db.apiKey.create({ data: { ownerId: 'key-only', name: 'Synthetic metadata', prefix: 'synthetic', digest: '0'.repeat(64), scopes: ['orders:read'], expiresAt: new Date('2030-01-01T00:00:00Z') } });
    await db.order.create({ data: { id: 'receipt-order', code: 'DH-RECEIPT-ONLY', userId: 'resource-owner', totalAmount: '1.000001' } });
    await db.deposit.create({ data: { id: 'receipt-deposit', code: 'NAP-RECEIPT-ONLY', userId: 'resource-owner', amountUsdt: '1.000001', vndAmount: 26000, expiresAt: new Date('2030-01-01T00:00:00Z') } });
    await db.apiOperationReceipt.createMany({ data: [
      { ownerId: 'receipt-only', operation: 'orders.create', idempotencyKey: 'synthetic-order-request', requestHash: '1'.repeat(64), orderId: 'receipt-order' },
      { ownerId: 'receipt-only', operation: 'deposits.create', idempotencyKey: 'synthetic-deposit-request', requestHash: '2'.repeat(64), depositId: 'receipt-deposit' },
    ] });
    const cases = [
      ['User', 'access-only', 'ApiAccess_userId_fkey'],
      ['User', 'key-only', 'ApiKey_ownerId_fkey'],
      ['User', 'receipt-only', 'ApiOperationReceipt_ownerId_fkey'],
      ['Order', 'receipt-order', 'ApiOperationReceipt_orderId_fkey'],
      ['Deposit', 'receipt-deposit', 'ApiOperationReceipt_depositId_fkey'],
    ] as const;
    for (const [table, id, constraint] of cases) {
      await expect(db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1`, id)).rejects.toMatchObject({
        code: 'P2010', meta: { code: '23503', message: expect.stringContaining(constraint) },
      });
    }
    expect(await db.apiOperationReceipt.count()).toBe(2);
    expect(await db.order.count({ where: { id: 'receipt-order' } })).toBe(1);
    expect(await db.deposit.count({ where: { id: 'receipt-deposit' } })).toBe(1);
    expect(await db.stockItem.count()).toBe(4);
  });
});
