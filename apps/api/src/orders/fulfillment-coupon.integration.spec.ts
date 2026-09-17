import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, type Coupon, type OrderStatus, type PaymentStatus, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FulfillmentService } from './fulfillment.service';
import { CouponsService } from '../coupons/coupons.service';
import { K } from '../i18n/messages';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { lockFinancialArbitration } from '../common/financial-lock';
import { markOrderPaid } from '../common/order-settlement';

const baseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/webcatt';
const database = `webcatt_fulfillment_coupon_test_${process.pid}`;
const transactionOptions = { maxWait: 15_000, timeout: 15_000 };
let db: PrismaClient;
let ready = false;
let fulfillment: FulfillmentService;
let coupons: CouponsService;
let sequence = 0;

function client(name: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

beforeAll(async () => {
  const admin = client('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
  } catch {
    await admin.$disconnect();
    return;
  }
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }
  db = client(database);
  const directory = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
    const sql = readFileSync(join(directory, folder, 'migration.sql'), 'utf8');
    // Các migration hiện tại là DDL thuần; không bỏ lỗi setup thành test skip.
    for (const statement of sql.split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--')).join('\n')
      .split(';').map((part) => part.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  }
  fulfillment = new FulfillmentService(db as unknown as PrismaService);
  coupons = new CouponsService(db as unknown as PrismaService, {} as AuditService);
  ready = true;
}, 120_000);

afterAll(async () => {
  if (!db) return;
  await db.$disconnect();
  const admin = client('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}, 60_000);

function dbTest(name: string, run: () => Promise<void>) {
  it(name, async (context) => {
    if (!ready) return context.skip();
    await run();
  }, 30_000);
}

async function makeUser() {
  const tag = `lifecycle-${++sequence}`;
  return db.user.create({
    data: { code: 91000000 + sequence, email: `${tag}@test.invalid`, passwordHash: 'synthetic' },
  });
}

async function makeCoupon(data: Partial<Prisma.CouponUncheckedCreateInput> = {}) {
  return db.coupon.create({
    data: { code: `LIFECYCLE-${++sequence}`, type: 'FIXED', value: 1, ...data },
  });
}

async function makeOrder(options: {
  coupon?: Coupon;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  expiresAt?: Date;
} = {}) {
  const user = await makeUser();
  const tag = `lifecycle-order-${++sequence}`;
  const product = await db.product.create({ data: { slug: tag, name: tag } });
  const variant = await db.productVariant.create({
    data: { productId: product.id, name: tag, price: 10, priceAmount: 10 },
  });
  const order = await db.order.create({
    data: {
      code: tag, userId: user.id, status: options.status ?? 'PENDING', totalAmount: 9,
      subtotalAmount: 10, discountAmount: options.coupon ? 1 : 0,
      couponId: options.coupon?.id, couponCode: options.coupon?.code,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 600_000),
      items: { create: {
        productId: product.id, variantId: variant.id, productName: tag,
        variantName: tag, unitPrice: 10, quantity: 1,
      } },
      payment: { create: {
        merchantTradeNo: tag, amount: 9, status: options.paymentStatus ?? 'PENDING',
        cryptoTxId: options.paymentStatus === 'SUCCESS' ? `received-${tag}` : null,
        sepayRef: options.paymentStatus === 'SUCCESS' ? `sepay-${tag}` : null,
      } },
    },
    include: { items: true, payment: true },
  });
  const stock = await db.stockItem.create({
    data: {
      variantId: variant.id, content: `SYNTHETIC-${tag}`,
      status: 'RESERVED', orderItemId: order.items[0].id,
    },
  });
  return { order, stock, variant };
}

function barrier() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

async function blockedTransactions() {
  const [row] = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `;
  return row.count;
}

async function waitUntil(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Không quan sát được điều kiện tranh khóa trong 5 giây');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('lifecycle/coupon trên PostgreSQL thật', () => {
  for (const status of ['PENDING', 'CANCELLED', 'EXPIRED'] as const) {
    dbTest(`không giao key cho đơn ${status} dù đang có kho RESERVED`, async () => {
      const fixture = await makeOrder({ status });
      expect(await fulfillment.deliverOrder(fixture.order.id)).toBe(false);
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe(status);
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
    });
  }

  for (const action of ['cancel', 'expire', 'sweep'] as const) {
    dbTest(`${action} giữ Payment SUCCESS/ref và promote đơn legacy PENDING trước khi nhả kho`, async () => {
      const coupon = await makeCoupon({ usedCount: 1 });
      const fixture = await makeOrder({
        coupon, paymentStatus: 'SUCCESS', expiresAt: new Date(Date.now() - 60_000),
      });
      if (action === 'cancel') await fulfillment.cancelOrderInternal(fixture.order.id);
      else if (action === 'expire') await fulfillment.expireOrder(fixture.order.id);
      else await fulfillment.releaseExpiredOrders();
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId: fixture.order.id } });
      expect(payment.status).toBe('SUCCESS');
      expect(payment.cryptoTxId).toBe(fixture.order.payment!.cryptoTxId);
      expect(payment.sepayRef).toBe(fixture.order.payment!.sepayRef);
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PAID');
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
      expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    });
  }

  dbTest('hai sweep cùng snapshot không trừ lượt coupon của đơn khác vẫn còn hiệu lực', async () => {
    const coupon = await makeCoupon({ usedCount: 2 });
    const stale = await makeOrder({ coupon, expiresAt: new Date(Date.now() - 60_000) });
    const live = await makeOrder({ coupon });
    const entered = barrier();
    const release = barrier();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${stale.order.id} FOR UPDATE`;
      entered.open();
      await release.wait;
    }, transactionOptions);
    await entered.wait;
    const sweeps = Promise.all([fulfillment.releaseExpiredOrders(), fulfillment.releaseExpiredOrders()]);
    try {
      // Bản cũ: cả hai chờ Order sau khi đọc PENDING. Bản mới: một chờ Order,
      // một chờ arbitration. Đều thật sự chồng lấn, không dựa vào sleep đoán lịch.
      await waitUntil(async () => (await blockedTransactions()) >= 2);
    } finally {
      release.open();
      await blocker;
      await sweeps;
    }
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: live.order.id } })).status).toBe('PENDING');
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: live.stock.id } })).status).toBe('RESERVED');
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: stale.stock.id } })).status).toBe('AVAILABLE');
  });

  const staleMerchantSessions: Array<{ name: string; change: Prisma.PaymentUpdateInput }> = [
    { name: 'merchant ref khác', change: { merchantTradeNo: 'synthetic-new-merchant-session' } },
    { name: 'version khác', change: { sessionVersion: 2 } },
    { name: 'đã chuyển sang SEPAY', change: { mode: 'SEPAY' } },
  ];
  for (const { name, change } of staleMerchantSessions) {
    dbTest(`gateway close ${name} đọc lại phiên sau arbitration và không nhả đơn mới`, async () => {
      const coupon = await makeCoupon({ usedCount: 1 });
      const fixture = await makeOrder({ coupon });
      const payment = await db.payment.update({
        where: { orderId: fixture.order.id }, data: { mode: 'BINANCE', sessionVersion: 1 },
      });
      const expected = { merchantTradeNo: payment.merchantTradeNo, sessionVersion: 1 };
      const entered = barrier();
      const release = barrier();
      // Giữ khóa của đường đổi phương thức khi close còn cầm snapshot cũ.
      const selection = db.$transaction(async (tx) => {
        await lockFinancialArbitration(tx);
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${fixture.order.id} FOR UPDATE`;
        await tx.payment.update({ where: { id: payment.id }, data: change });
        entered.open();
        await release.wait;
      }, transactionOptions);
      await entered.wait;
      const close = fulfillment.expireOrder(fixture.order.id, expected);
      try {
        await waitUntil(async () => (await blockedTransactions()) > 0);
      } finally {
        release.open();
        await selection;
        await close;
      }
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
      expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    });
  }

  dbTest('gateway close phiên hiện tại vẫn đóng và replay không trả coupon hai lần', async () => {
    const coupon = await makeCoupon({ usedCount: 2 });
    const fixture = await makeOrder({ coupon });
    await makeOrder({ coupon });
    const payment = await db.payment.update({
      where: { orderId: fixture.order.id }, data: { mode: 'BINANCE', sessionVersion: 4 },
    });
    const expected = { merchantTradeNo: payment.merchantTradeNo, sessionVersion: payment.sessionVersion };
    await fulfillment.expireOrder(fixture.order.id, expected);
    await fulfillment.expireOrder(fixture.order.id, expected);
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('EXPIRED');
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('EXPIRED');
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('AVAILABLE');
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
  });

  dbTest('gateway close đúng phiên có Payment SUCCESS chỉ promote legacy, không nhả kho', async () => {
    const coupon = await makeCoupon({ usedCount: 1 });
    const fixture = await makeOrder({ coupon, paymentStatus: 'SUCCESS' });
    const payment = await db.payment.update({
      where: { orderId: fixture.order.id }, data: { mode: 'BINANCE', sessionVersion: 5 },
    });
    await fulfillment.expireOrder(fixture.order.id, {
      merchantTradeNo: payment.merchantTradeNo, sessionVersion: payment.sessionVersion,
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PAID');
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('SUCCESS');
    expect(after.cryptoTxId).toBe(payment.cryptoTxId);
    expect(after.sepayRef).toBe(payment.sepayRef);
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
  });

  dbTest('cancel và expire cùng đơn chỉ trả một lượt coupon', async () => {
    const coupon = await makeCoupon({ usedCount: 2 });
    const closing = await makeOrder({ coupon });
    await makeOrder({ coupon });
    await Promise.all([
      fulfillment.cancelOrderInternal(closing.order.id),
      fulfillment.expireOrder(closing.order.id),
      fulfillment.cancelOrderInternal(closing.order.id),
    ]);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: closing.stock.id } })).status).toBe('AVAILABLE');
  });

  dbTest('late-paid khôi phục lượt EXPIRED đúng một lần kể cả coupon đã đầy', async () => {
    const coupon = await makeCoupon({ maxUses: 1, usedCount: 1 });
    const late = await makeOrder({ coupon });
    await fulfillment.expireOrder(late.order.id);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    await makeOrder({ coupon });
    await db.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    await Promise.all([
      fulfillment.markPaidAndDeliver({ orderId: late.order.id }),
      fulfillment.markPaidAndDeliver({ orderId: late.order.id }),
    ]);
    await fulfillment.markPaidAndDeliver({ orderId: late.order.id });
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(2);
    expect((await db.order.findUniqueOrThrow({ where: { id: late.order.id } })).status).toBe('DELIVERED');
    expect(await db.stockItem.count({ where: { variantId: late.variant.id, status: 'SOLD' } })).toBe(1);
  });

  dbTest('payment ghi thất bại rollback luôn Order PAID, không để trạng thái nửa chừng', async () => {
    const fixture = await makeOrder();
    await db.payment.update({ where: { orderId: fixture.order.id }, data: { merchantTradeNo: `FAULT-${sequence}` } });
    // CHECK chỉ ở CSDL test: gây lỗi ghi thật để kiểm tra ranh giới transaction.
    await db.$executeRawUnsafe(`ALTER TABLE "Payment" ADD CONSTRAINT "test_payment_success_failure"
      CHECK ("merchantTradeNo" NOT LIKE 'FAULT-%' OR "status" <> 'SUCCESS')`);
    try {
      await expect(fulfillment.markPaidAndDeliver({ orderId: fixture.order.id })).rejects.toThrow();
      expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.payment.findUniqueOrThrow({ where: { orderId: fixture.order.id } })).status).toBe('PENDING');
      expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "Payment" DROP CONSTRAINT "test_payment_success_failure"');
    }
  });

  dbTest('đơn CANCELLED không được webhook trả muộn hồi sinh hay giữ lại coupon', async () => {
    const coupon = await makeCoupon({ usedCount: 1 });
    const fixture = await makeOrder({ coupon });
    await fulfillment.cancelOrderInternal(fixture.order.id);
    expect(await fulfillment.markPaidAndDeliver({ orderId: fixture.order.id }))
      .toEqual({ status: 'CANCELLED', delivered: false });
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: fixture.order.id } })).status).toBe('FAILED');
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    expect(await db.stockItem.count({ where: { variantId: fixture.variant.id, status: 'SOLD' } })).toBe(0);
  });

  dbTest('delivery chờ khóa Variant trước Stock để không đảo khóa với import', async () => {
    const fixture = await makeOrder({ status: 'PAID', paymentStatus: 'SUCCESS' });
    const entered = barrier();
    const release = barrier();
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ${fixture.variant.id} FOR UPDATE`;
      entered.open();
      await release.wait;
    }, transactionOptions);
    await entered.wait;
    let settled = false;
    const delivery = fulfillment.deliverOrder(fixture.order.id).finally(() => { settled = true; });
    try {
      await waitUntil(async () => settled || (await blockedTransactions()) > 0);
      expect(settled).toBe(false);
      const unlocked = await db.$transaction((tx) => tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockItem" WHERE "id" = ${fixture.stock.id} FOR UPDATE SKIP LOCKED
      `);
      expect(unlocked).toEqual([{ id: fixture.stock.id }]);
    } finally {
      release.open();
      await blocker;
      await delivery;
    }
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('SOLD');
  });

  dbTest('hai reservation cùng user chỉ một đơn qua perUserLimit dù validate từ snapshot cũ', async () => {
    const user = await makeUser();
    const coupon = await makeCoupon({ maxUses: 20, perUserLimit: 1 });
    const create = () => db.$transaction(async (tx) => {
      await coupons.reserve(tx, coupon, user.id);
      return tx.order.create({ data: {
        code: `coupon-admission-${++sequence}`, userId: user.id, couponId: coupon.id,
        totalAmount: 9, subtotalAmount: 10, discountAmount: 1,
      } });
    }, transactionOptions);
    const results = await Promise.allSettled([create(), create()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toBe(K.couponUserLimit);
    expect(await db.order.count({ where: { userId: user.id, couponId: coupon.id } })).toBe(1);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
  });

  dbTest('helper nhận Payment SUCCESS từ caller và không giao kho trước commit', async () => {
    const coupon = await makeCoupon({ usedCount: 1 });
    const fixture = await makeOrder({ coupon });
    const results = await db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${fixture.order.id} FOR UPDATE`;
      await tx.payment.updateMany({
        where: { orderId: fixture.order.id, status: 'PENDING' },
        data: { status: 'SUCCESS', cryptoTxId: 'synthetic-verified-caller' },
      });
      const first = await markOrderPaid(tx, fixture.order.id);
      const replay = await markOrderPaid(tx, fixture.order.id);
      expect((await tx.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
      return { first, replay };
    }, transactionOptions);
    expect(results).toEqual({
      first: { status: 'PAID', changed: true },
      replay: { status: 'PAID', changed: false },
    });
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: fixture.order.id } })).cryptoTxId)
      .toBe('synthetic-verified-caller');
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    expect(await fulfillment.deliverOrder(fixture.order.id)).toBe(true);
    expect(await db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      return markOrderPaid(tx, fixture.order.id);
    })).toEqual({ status: 'DELIVERED', changed: false });
  });

  dbTest('helper rollback cùng caller trả EXPIRED/coupon/payment về nguyên trạng', async () => {
    const coupon = await makeCoupon({ usedCount: 0 });
    const fixture = await makeOrder({ coupon, status: 'EXPIRED', paymentStatus: 'EXPIRED' });
    await expect(db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      expect(await markOrderPaid(tx, fixture.order.id)).toEqual({ status: 'PAID', changed: true });
      expect((await tx.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
      throw new Error('synthetic caller rollback');
    })).rejects.toThrow('synthetic caller rollback');
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('EXPIRED');
    expect((await db.payment.findUniqueOrThrow({ where: { orderId: fixture.order.id } })).status).toBe('EXPIRED');
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
  });

  dbTest('helper trả null khi thiếu Order và fail-closed nếu thiếu Payment', async () => {
    expect(await db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      return markOrderPaid(tx, 'synthetic-order-missing');
    })).toBeNull();
    const fixture = await makeOrder();
    await db.payment.delete({ where: { orderId: fixture.order.id } });
    await expect(db.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      return markOrderPaid(tx, fixture.order.id);
    })).rejects.toThrow(K.paymentSessionMissing);
    expect((await db.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe('PENDING');
    expect((await db.stockItem.findUniqueOrThrow({ where: { id: fixture.stock.id } })).status).toBe('RESERVED');
  });

  const staleCases: Array<{
    name: string;
    change: Prisma.CouponUpdateInput;
    key: string;
  }> = [
    { name: 'inactive', change: { active: false }, key: K.couponInactive },
    { name: 'expired', change: { expiresAt: new Date(0) }, key: K.couponExpired },
    { name: 'not-started', change: { startsAt: new Date('2100-01-01') }, key: K.couponNotStarted },
    { name: 'maxUses giảm sau preview', change: { maxUses: 0 }, key: K.couponExhausted },
    { name: 'perUserLimit giảm sau preview', change: { perUserLimit: 0 }, key: K.couponUserLimit },
  ];
  for (const { name, change, key } of staleCases) {
    dbTest(`reserve đọc lại coupon ${name} dưới khóa thay vì tin preview cũ`, async () => {
      const user = await makeUser();
      const coupon = await makeCoupon();
      await db.coupon.update({ where: { id: coupon.id }, data: change });
      await expect(db.$transaction((tx) => coupons.reserve(tx, coupon, user.id)))
        .rejects.toThrow(key);
      expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    });
  }
});
