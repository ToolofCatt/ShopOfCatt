import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BalanceService } from '../balance/balance.service';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { CouponsService } from '../coupons/coupons.service';
import { K } from '../i18n/messages';
import { FulfillmentService } from './fulfillment.service';
import { OrdersService } from './orders.service';

// Chỉ chạy khi caller chỉ rõ PG cách ly; tuyệt đối không lấy DATABASE_URL/.env
// hoặc tự dò cổng shop thật để chứng minh tính nguyên tử bằng dữ liệu thử.
const base = process.env.PARTNER_TRANSACTION_TEST_DATABASE_URL;
const database = `catt_tx_test_${randomBytes(6).toString('hex')}`;
function client(name: string) {
  const url = new URL(base!);
  url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

describe.skipIf(!base)('partner transaction composition (isolated PostgreSQL)', () => {
  let db: PrismaClient;
  let orders: OrdersService;
  let balance: BalanceService;
  let fulfillment: FulfillmentService;
  let createdDatabase = false;
  let sequence = 0;

  beforeAll(async () => {
    const admin = client('postgres');
    try {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      createdDatabase = true;
    } finally { await admin.$disconnect(); }
    db = client(database);
    const directory = resolve(__dirname, '../../prisma/migrations');
    for (const folder of readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      const sql = readFileSync(join(directory, folder, 'migration.sql'), 'utf8');
      for (const statement of sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((part) => part.trim()).filter(Boolean)) {
        await db.$executeRawUnsafe(statement);
      }
    }
    const settings = {
      getEnabledMethods: async () => [{ method: 'sepay' }],
      getPublicRates: async () => ({ vndPerUsdt: 26_000 }),
      getSepayConfig: async () => ({ ready: true, vndPerUsdt: 26_000, accountNumber: '007', bank: 'MB', accountHolder: 'Synthetic' }),
      getTelegramConfig: async () => ({ enabled: false, token: '', ownerChatId: '', ownerOrderAlertsEnabled: false }),
    };
    const forbidden = new Proxy({}, { get() { throw new Error('external operation is forbidden'); } });
    fulfillment = new FulfillmentService(db as any);
    orders = new OrdersService(db as any, { get: () => undefined } as any, fulfillment,
      forbidden as any, forbidden as any, settings as any, new CouponsService(db as any, forbidden as any));
    balance = new BalanceService(db as any, settings as any, fulfillment, new WalletCreditService(db as any));
  }, 120_000);

  afterAll(async () => {
    if (db) await db.$disconnect();
    if (!createdDatabase) return;
    const admin = client('postgres');
    try { await admin.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`); }
    finally { await admin.$disconnect(); }
  }, 30_000);

  async function fixture(stock = 1, funds = 10) {
    const tag = `tx-${++sequence}`;
    const user = await db.user.create({ data: { code: 97000000 + sequence, passwordHash: 'synthetic', balance: funds } });
    const product = await db.product.create({ data: { slug: tag, name: tag } });
    const variant = await db.productVariant.create({ data: { productId: product.id, name: tag, price: 2, priceAmount: 2 } });
    for (let i = 0; i < stock; i++) await db.stockItem.create({ data: { variantId: variant.id, content: `SYNTHETIC-${tag}-${i}` } });
    const coupon = await db.coupon.create({ data: { code: `TX-${sequence}`, type: 'FIXED', value: '0.5', minAmount: 0, maxUses: 10, perUserLimit: 1 } });
    return { user, variant, coupon };
  }
  async function buy(f: Awaited<ReturnType<typeof fixture>>, quantity = 1) {
    return db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      const prepared = await orders.createPendingOrderInTransaction(tx, f.user, {
        items: [{ variantId: f.variant.id, quantity }], couponCode: f.coupon.code,
      }, 'BALANCE');
      await balance.payOrderInTransaction(tx, f.user.id, prepared.orderId, { requireUnlockedUser: true });
      await orders.reserveOrderStockInTransaction(tx, prepared);
      return prepared;
    }, FINANCIAL_TRANSACTION);
  }
  async function expectNoPurchase(f: Awaited<ReturnType<typeof fixture>>) {
    expect((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).balance.toString()).toBe(f.user.balance.toString());
    expect(await db.balanceEntry.count({ where: { userId: f.user.id } })).toBe(0);
    expect(await db.order.count({ where: { userId: f.user.id } })).toBe(0);
    expect(await db.payment.count({ where: { order: { userId: f.user.id } } })).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: f.coupon.id } })).usedCount).toBe(0);
    expect(await db.stockItem.count({ where: { variantId: f.variant.id, status: { not: 'AVAILABLE' } } })).toBe(0);
  }

  it('rolls back debit, ledger, payment, order and coupon when stock is insufficient', async () => {
    const f = await fixture(1);
    await expect(buy(f, 2)).rejects.toMatchObject({ response: { key: K.orderInsufficientStock } });
    await expectNoPurchase(f);
  });

  it('rolls back creation and coupon when wallet funds are insufficient', async () => {
    const f = await fixture(1, 1);
    await expect(buy(f)).rejects.toThrow(K.balanceInsufficient);
    await expectNoPurchase(f);
  });

  it('debits exactly once and reserves in commit, then delivers idempotently outside it', async () => {
    const f = await fixture();
    const prepared = await buy(f);
    expect(prepared.total.toString()).toBe('1.5');
    expect((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).balance.toString()).toBe('8.5');
    expect((await db.order.findUniqueOrThrow({ where: { id: prepared.orderId } })).status).toBe('PAID');
    expect(await db.stockItem.count({ where: { variantId: f.variant.id, status: 'RESERVED' } })).toBe(1);
    expect(await db.balanceEntry.count({ where: { userId: f.user.id } })).toBe(1);
    await expect(balance.payOrderWithBalance(f.user.id, prepared.code)).rejects.toThrow(K.balanceOrderNotPending);
    await Promise.all([fulfillment.deliverOrder(prepared.orderId), fulfillment.deliverOrder(prepared.orderId)]);
    expect(await db.stockItem.count({ where: { variantId: f.variant.id, status: 'SOLD' } })).toBe(1);
    expect(await db.balanceEntry.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it('preserves web/Telegram callback replay and the existing pay-and-deliver wrapper', async () => {
    const f = await fixture();
    const dto = { items: [{ variantId: f.variant.id, quantity: 1 }] };
    const options = { telegramCallbackId: `synthetic-callback-${sequence}` };
    const first = await orders.create(f.user, dto, options);
    const replay = await orders.create(f.user, dto, options);
    expect(replay.order.id).toBe(first.order.id);
    expect(first.payment.mode).toBe('SEPAY');
    expect(await db.order.count({ where: { userId: f.user.id } })).toBe(1);
    expect((await balance.payOrderWithBalance(f.user.id, first.order.code)).delivered).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).balance.toString()).toBe('8');
  });

  it('rolls back deposit insert if the caller cannot persist its receipt', async () => {
    const f = await fixture();
    const prepared = await balance.prepareDeposit(f.user.id, 26_000, 'sepay');
    await expect(db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      await balance.createDepositInTransaction(tx, f.user.id, prepared);
      throw new Error('receipt persistence failed');
    }, FINANCIAL_TRANSACTION)).rejects.toThrow('receipt persistence failed');
    expect(await db.deposit.count({ where: { userId: f.user.id } })).toBe(0);
  });
});
