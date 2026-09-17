import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';
import { FulfillmentService } from './fulfillment.service';
import { CouponsService } from '../coupons/coupons.service';

function fixture() {
  const events: string[] = [];
  const variant = {
    id: 'variant', productId: 'product', name: 'Loại', active: true,
    price: new Prisma.Decimal('0.1'), product: { id: 'product', name: 'Sản phẩm', active: true },
  };
  const orderCreate = vi.fn(async ({ data }) => { events.push('order'); return { id: 'order', ...data }; });
  const paymentCreate = vi.fn(async ({ data }) => { events.push('payment'); return { id: 'payment', ...data }; });
  const stockUpdate = vi.fn(async (_args: any) => { events.push('reserve'); return { count: 3 }; });
  const tx = {
    $queryRaw: vi.fn(async (sql: any) => {
      const text = Array.isArray(sql) ? sql.join('') : sql.sql;
      if (text.includes('"StockItem"')) { events.push('stock-lock'); return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; }
      return [];
    }),
    productVariant: {
      findMany: vi.fn(async () => [{ productId: 'product' }]),
      findFirst: vi.fn(async () => variant),
      findUnique: vi.fn(async () => ({ product: { stockDrawMode: 'SEQUENTIAL' } })),
    },
    order: { findUnique: vi.fn(async () => null), create: orderCreate },
    orderItem: { create: vi.fn(async ({ data }) => ({ id: 'item', ...data })) },
    payment: { create: paymentCreate },
    stockItem: { updateMany: stockUpdate, count: vi.fn(async () => 0) },
    coupon: { findUnique: vi.fn(async () => null) },
  };
  // Chặn truy cập ngoài tx: helper không được lén mở transaction/settings/gateway.
  const forbidden = new Proxy({}, { get() { throw new Error('outside transaction'); } });
  const fulfillment = new FulfillmentService(forbidden as any);
  const service = new OrdersService(forbidden as any, { get: () => undefined } as any,
    fulfillment, forbidden as any, forbidden as any, forbidden as any,
    new CouponsService(forbidden as any, forbidden as any));
  return { service, tx, events, variant, orderCreate, paymentCreate, stockUpdate };
}

describe('order transaction boundary', () => {
  it('merges quantities and creates Decimal-priced order/payment before the caller reserves stock', async () => {
    const f = fixture();
    const prepared = await f.service.createPendingOrderInTransaction(f.tx as any, { id: 'buyer' }, {
      items: [{ variantId: 'variant', quantity: 1 }, { variantId: 'variant', quantity: 2 }],
    }, 'BALANCE');
    expect(prepared.total).toBeInstanceOf(Prisma.Decimal);
    expect(prepared.total.toString()).toBe('0.3');
    expect(prepared.reservationPlan).toEqual([
      { orderItemId: 'item', variantId: 'variant', quantity: 3, name: 'Sản phẩm – Loại' },
    ]);
    expect(f.events).toEqual(['order', 'payment']);
    expect(f.paymentCreate.mock.calls[0][0].data.mode).toBe('BALANCE');
    f.events.push('user-debit');
    await f.service.reserveOrderStockInTransaction(f.tx as any, prepared);
    expect(f.events).toEqual(['order', 'payment', 'user-debit', 'stock-lock', 'reserve']);
    expect(f.stockUpdate.mock.calls[0][0]).toEqual({
      where: { id: { in: ['a', 'b', 'c'] }, status: 'AVAILABLE' },
      data: { status: 'RESERVED', orderItemId: 'item' },
    });
  });

  it('refuses insufficient stock without swallowing the error that must roll back the caller transaction', async () => {
    const f = fixture();
    const prepared = await f.service.createPendingOrderInTransaction(f.tx as any, { id: 'buyer' }, {
      items: [{ variantId: 'variant', quantity: 4 }],
    }, 'BALANCE');
    await expect(f.service.reserveOrderStockInTransaction(f.tx as any, prepared)).rejects.toMatchObject({
      response: { params: { name: 'Sản phẩm – Loại', remaining: 0 } },
    });
    expect(f.stockUpdate).not.toHaveBeenCalled();
  });

  it('prices a coupon from the locked current row rather than its stale pre-lock value', async () => {
    const f = fixture();
    const coupon = {
      id: 'coupon', code: 'SALE', active: true, type: 'PERCENT', value: new Prisma.Decimal(10),
      minAmount: new Prisma.Decimal(0), startsAt: null, expiresAt: null,
      maxUses: 5, usedCount: 0, perUserLimit: null,
    };
    const tx = { ...f.tx, coupon: {
      findUnique: vi.fn().mockResolvedValueOnce(coupon).mockResolvedValueOnce({ ...coupon, value: new Prisma.Decimal(50) }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    } };
    const query = f.tx.$queryRaw.getMockImplementation()!;
    tx.$queryRaw.mockImplementation(async (sql: any) => {
      if (Array.isArray(sql) && sql.join('').includes('"Coupon"')) return [coupon] as any;
      return query(sql);
    });
    const prepared = await f.service.createPendingOrderInTransaction(tx as any, { id: 'buyer' }, {
      items: [{ variantId: 'variant', quantity: 10 }], couponCode: ' sale ',
    }, 'BALANCE');
    expect(prepared.total.toString()).toBe('0.5');
    expect(f.orderCreate.mock.calls[0][0].data.couponCode).toBe('SALE');
  });

  it('rejects inactive/missing variants before creating an order or payment', async () => {
    const f = fixture();
    f.tx.productVariant.findFirst.mockResolvedValueOnce(null as any);
    await expect(f.service.createPendingOrderInTransaction(f.tx as any, { id: 'buyer' }, {
      items: [{ variantId: 'variant', quantity: 1 }],
    }, 'BALANCE')).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
});
