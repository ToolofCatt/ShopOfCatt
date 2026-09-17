import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FulfillmentService } from './fulfillment.service';
import { OrdersService } from './orders.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { BinanceService } from '../payments/binance.service';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { BalanceService } from '../balance/balance.service';
import { CryptoReconcileService } from './crypto-reconcile.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { AuditService } from '../audit/audit.service';
import type { BinanceDeposit } from '../binance-exchange/deposit-matcher';
import { lockFinancialArbitration } from '../common/financial-lock';
import { observeTransfer, settleOrderTransfer } from '../common/incoming-transfer';

const base = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/webcatt';
const database = 'webcatt_settlement_regression_test';
function client(name: string) {
  const url = new URL(base); url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}
let db: PrismaClient;
let ready = false;
let orders: OrdersService;
let fulfillment: FulfillmentService;
let settings: SettingsService;
let payments: PaymentsService;
let wallet: WalletCreditService;
let balance: BalanceService;
let exchange: BinanceExchangeService;
let config: ConfigService;
let gateway: BinanceService;
const configValues: Record<string, string> = { PAYMENT_MOCK: 'false', ORDER_EXPIRE_MINUTES: '30' };
let deposit: BinanceDeposit | undefined;
let sequence = 0;
const address = `0x${'1'.repeat(40)}`;

beforeAll(async () => {
  const root = client('postgres');
  try { await root.$queryRaw`SELECT 1`; } catch { await root.$disconnect(); return; }
  try {
    await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await root.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally { await root.$disconnect(); }
  db = client(database);
  const directory = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(directory, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const sql = readFileSync(join(directory, folder, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  }
  const prisma = db as unknown as PrismaService;
  config = { get: (key: string) => configValues[key] } as unknown as ConfigService;
  settings = new SettingsService(prisma, config, { log: async () => {} } as unknown as AuditService);
  fulfillment = new FulfillmentService(prisma);
  wallet = new WalletCreditService(prisma);
  balance = new BalanceService(prisma, settings, fulfillment, wallet);
  payments = new PaymentsService(prisma, config, fulfillment, settings, balance);
  gateway = new BinanceService(config);
  exchange = {
    isConfigured: true,
    listUsdtDeposits: async () => deposit ? [deposit] : [],
    findDepositByTxId: async () => deposit ?? null,
    listPayTransactions: async () => [],
  } as unknown as BinanceExchangeService;
  orders = new OrdersService(prisma, config, fulfillment, gateway, exchange, settings, {} as CouponsService);
  await db.storeSetting.create({ data: { id: 'main', cryptoEnabled: true, bep20Address: address, vndPerUsdt: 26000 } });
  ready = true;
}, 120_000);
afterAll(async () => {
  if (!db) return;
  await db.$disconnect();
  const root = client('postgres');
  try { await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); } finally { await root.$disconnect(); }
});
function dbTest(name: string, run: () => Promise<void>) {
  it(name, async (context) => { if (!ready) return context.skip(); await run(); }, 30_000);
}
async function buyer(price = 5) {
  const tag = `settlement-${++sequence}`;
  const user = await db.user.create({ data: { code: 93000000 + sequence, email: `${tag}@test.invalid`, passwordHash: 'synthetic' } });
  const product = await db.product.create({ data: { slug: tag, name: tag } });
  const variant = await db.productVariant.create({ data: { productId: product.id, name: tag, price, priceAmount: price } });
  await db.stockItem.create({ data: { variantId: variant.id, content: `SYNTHETIC-${tag}` } });
  return { user, variant };
}
async function create(price: number) {
  const value = await buyer(price);
  const result = await orders.create(value.user, { items: [{ variantId: value.variant.id, quantity: 1 }] });
  return { ...value, order: result.order };
}
function incoming(amount: number) {
  return { txId: `synthetic-transfer-${++sequence}`, amount, network: 'BSC', insertTimeMs: Date.now(), status: 1 };
}
function barrier() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { entered, wait, enter, release };
}

describe('quyền sở hữu thanh toán và lifecycle', () => {
  dbTest('poll một đơn không thu hẹp tập hai đơn cùng amount', async () => {
    const a = await create(11), b = await create(11);
    deposit = incoming(11);
    const result = await orders.checkPayment(b.user.id, b.order.code);
    expect(result.delivered).toBe(false);
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe('PENDING');
    expect(await db.stockItem.count({ where: { status: 'SOLD', variantId: { in: [a.variant.id, b.variant.id] } } })).toBe(0);
  });
  dbTest('đổi phương thức đã đọc cũ không xóa reference sau settlement', async () => {
    const a = await create(12);
    deposit = incoming(12);
    const gate = barrier();
    const delayed = Object.create(settings) as SettingsService;
    delayed.getCryptoAddress = async (network) => { gate.enter(); await gate.wait; return settings.getCryptoAddress(network); };
    const service = new OrdersService(db as unknown as PrismaService, config, fulfillment, gateway, exchange, delayed, {} as CouponsService);
    const selection = service.selectPayment(a.user.id, a.order.code, 'crypto_bep20').catch(() => null);
    await gate.entered;
    try { expect((await orders.checkPayment(a.user.id, a.order.code)).delivered).toBe(true); }
    finally { gate.release(); }
    await selection;
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: a.order.id } })).cryptoTxId).toBe(deposit.txId);
  });
  dbTest('hủy không ghi FAILED vào payment đã nhận tiền', async () => {
    const a = await create(13);
    await db.payment.update({ where: { orderId: a.order.id }, data: { status: 'SUCCESS', cryptoTxId: `legacy-${sequence}` } });
    await fulfillment.cancelOrderInternal(a.order.id);
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: a.order.id } })).status).toBe('SUCCESS');
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).not.toBe('CANCELLED');
  });
  dbTest('nạp ví trước rồi tạo đơn cùng tiền không ưu tiên lấy tiền cho đơn', async () => {
    const value = await buyer(14);
    const topup = await balance.createDeposit(value.user, 364000, 'crypto_bep20');
    const a = await create(14);
    deposit = incoming(14);
    await new CryptoReconcileService(db as unknown as PrismaService, exchange, fulfillment, settings, wallet).tick();
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe('PENDING');
    expect((await db.deposit.findUniqueOrThrow({ where: { id: topup.deposit.id } })).status).toBe('PENDING');
  });
  dbTest('writer ví dùng candidate cũ không nhận lại transfer đơn vừa claim', async () => {
    const a = await create(15);
    deposit = incoming(15);
    await orders.submitTx(a.user.id, a.order.code, deposit.txId);
    const user = (await buyer()).user;
    const nap = await db.deposit.create({ data: { userId: user.id, code: `NAP-CLAIM${sequence}`, mode: 'CRYPTO', amountUsdt: 15, vndAmount: 390000, cryptoNetwork: 'BEP20', cryptoAddress: address, expiresAt: new Date(Date.now() + 600000) } });
    // Mô phỏng bước ghi của worker đã đọc ứng viên từ trước khi bên đơn commit.
    await wallet.credit(nap.id, { cryptoTxId: deposit.txId });
    const paidOrder = await db.order.count({ where: { id: a.order.id, status: { in: ['PAID', 'DELIVERED'] } } });
    const credited = await db.deposit.count({ where: { id: nap.id, status: 'SUCCESS' } });
    expect(paidOrder + credited).toBeLessThanOrEqual(1);
    expect(await db.balanceEntry.count({ where: { userId: user.id } })).toBe(credited);
  });
  dbTest('đổi kênh không xóa ứng viên của chỉ dẫn crypto đã công bố', async () => {
    const a = await create(18), b = await create(18);
    deposit = incoming(18);
    await db.storeSetting.update({ where: { id: 'main' }, data: { binanceIdEnabled: true, binanceId: 'SYNTHETIC' } });
    try {
      await orders.selectPayment(a.user.id, a.order.code, 'binance_id');
      expect((await orders.checkPayment(b.user.id, b.order.code)).delivered).toBe(false);
      expect((await db.order.findUniqueOrThrow({ where: { id: b.order.id } })).status).toBe('PENDING');
    } finally { await db.storeSetting.update({ where: { id: 'main' }, data: { binanceIdEnabled: false } }); }
  });
  dbTest('chỉ dẫn công bố muộn không dùng createdAt cũ để nhận tiền quá sớm', async () => {
    const a = await create(21);
    const old = new Date(Date.now() - 40 * 60000);
    await db.order.update({ where: { id: a.order.id }, data: { createdAt: old } });
    deposit = { ...incoming(21), insertTimeMs: Date.now() - 20 * 60000 };
    expect((await orders.checkPayment(a.user.id, a.order.code)).delivered).toBe(false);
  });
  dbTest('tiền muộn có chỉ dẫn cũ chưa đối soát không được tự gán cho đơn mới', async () => {
    const old = await create(22);
    const time = new Date(Date.now() - 25 * 3600000);
    await db.order.update({ where: { id: old.order.id }, data: { createdAt: time, status: 'EXPIRED' } });
    await db.paymentInstruction.updateMany({ where: { paymentId: (await db.payment.findUniqueOrThrow({ where: { orderId: old.order.id } })).id }, data: { createdAt: time } });
    const fresh = await create(22);
    deposit = incoming(22);
    expect((await orders.checkPayment(fresh.user.id, fresh.order.code)).delivered).toBe(false);
    expect((await db.incomingTransfer.findUniqueOrThrow({ where: { source_reference: { source: 'CRYPTO:BEP20', reference: deposit.txId } } })).reviewReason).toBe('older-unresolved-instruction');
  });
  dbTest('provider retry đổi timestamp hoặc receiver giữ trạng thái cần đối soát', async () => {
    await db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      const facts = { source: 'BINANCE_ID' as const, reference: 'facts-immutable', amount: 5, currency: 'USDT' as const, receiver: 'OLD', receivedAt: new Date(100000) };
      await observeTransfer(tx, facts);
      const changed = await observeTransfer(tx, { ...facts, receiver: 'NEW', receivedAt: new Date(200000) });
      expect(changed.status).toBe('REVIEW');
      expect(changed.receiver).toBe('OLD');
    });
  });
  dbTest('snapshot mã nạp SePay được giữ nguyên khi callback phát lại sau đổi tài khoản', async () => {
    await db.storeSetting.update({ where: { id: 'main' }, data: { sepayEnabled: true, sepayAccountNumber: 'ACCOUNT-A', sepayBank: 'MB', sepayApiKey: 'synthetic', vndPerUsdt: 26000 } });
    try {
      const value = await buyer();
      await balance.createDeposit(value.user, 26000, 'sepay', 'replay-bank');
      await db.storeSetting.update({ where: { id: 'main' }, data: { sepayAccountNumber: 'ACCOUNT-B', sepayBank: 'VCB' } });
      const replay = await balance.createDeposit(value.user, 26000, 'sepay', 'replay-bank');
      expect(replay.bank?.accountNumber).toBe('ACCOUNT-A');
      expect(replay.bank?.bank).toBe('MB');
    } finally { await db.storeSetting.update({ where: { id: 'main' }, data: { sepayEnabled: false } }); }
  });
  dbTest('claim legacy giữ đúng target và phục hồi Order EXPIRED chưa promote', async () => {
    const a = await create(19);
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: a.order.id } });
    await db.order.update({ where: { id: a.order.id }, data: { status: 'EXPIRED' } });
    await db.payment.update({ where: { id: payment.id }, data: { status: 'SUCCESS', cryptoTxId: 'legacy-claimed-recovery' } });
    const transfer = await db.incomingTransfer.create({ data: { source: 'CRYPTO:BEP20', reference: 'legacy-claimed-recovery', amount: 19, currency: 'USDT', status: 'CLAIMED', paymentId: payment.id } });
    await db.$transaction(async (tx) => { await lockFinancialArbitration(tx); await settleOrderTransfer(tx, payment.id, transfer); });
    expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe('PAID');
  });
  dbTest('mock DB tắt không xác nhận placeholder sau gateway lỗi', async () => {
    configValues.PAYMENT_MOCK = 'true'; configValues.BINANCE_PAY_API_KEY = 'synthetic-no-secret';
    await db.storeSetting.update({ where: { id: 'main' }, data: { binancePayEnabled: true, mockEnabled: false } });
    try {
      const value = await buyer(16);
      await expect(orders.create(value.user, { items: [{ variantId: value.variant.id, quantity: 1 }] })).rejects.toThrow();
      const order = await db.order.findFirstOrThrow({ where: { userId: value.user.id } });
      await expect(payments.confirmMock(value.user.id, order.code)).rejects.toThrow();
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
    } finally {
      configValues.PAYMENT_MOCK = 'false'; delete configValues.BINANCE_PAY_API_KEY;
      await db.storeSetting.update({ where: { id: 'main' }, data: { binancePayEnabled: false } });
    }
  });
  dbTest('SePay tới sau expiry vẫn chốt đúng một lần', async () => {
    await db.storeSetting.update({ where: { id: 'main' }, data: { sepayEnabled: true, sepayAccountNumber: 'TEST-ACCOUNT', sepayBank: 'MB', sepayApiKey: 'synthetic', vndPerUsdt: 26000 } });
    try {
      const a = await create(17);
      await fulfillment.expireOrder(a.order.id);
      const event = { id: `late-${sequence}`, transferType: 'in', transferAmount: 442000, content: a.order.code, accountNumber: 'TEST-ACCOUNT' };
      await payments.handleSepayWebhook(event);
      await payments.handleSepayWebhook(event);
      expect((await db.order.findUniqueOrThrow({ where: { id: a.order.id } })).status).toBe('DELIVERED');
      expect(await db.stockItem.count({ where: { variantId: a.variant.id, status: 'SOLD' } })).toBe(1);
    } finally { await db.storeSetting.update({ where: { id: 'main' }, data: { sepayEnabled: false } }); }
  });
});
