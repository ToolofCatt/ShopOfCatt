import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface MarkPaidResult {
  status: OrderStatus;
  delivered: boolean;
}

/**
 * Toàn bộ logic giữ kho / giao hàng / nhả kho — phần quan trọng nhất về
 * tính đúng đắn (concurrency-safe nhờ FOR UPDATE SKIP LOCKED + guard status).
 */
@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Khóa (lock) các dòng kho AVAILABLE của một loại sản phẩm — bỏ qua các dòng
   * đang bị transaction khác giữ (SKIP LOCKED).
   */
  async lockAvailableStock(
    tx: Prisma.TransactionClient,
    variantId: string,
    limit: number,
  ): Promise<string[]> {
    if (limit <= 0) return [];
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "StockItem"
      WHERE "variantId" = ${variantId}
        AND "status" = 'AVAILABLE'::"StockStatus"
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Nhả các đơn PENDING đã quá hạn: đơn → EXPIRED, payment → EXPIRED,
   * kho RESERVED → AVAILABLE.
   */
  async releaseExpiredOrders(tx?: Prisma.TransactionClient): Promise<void> {
    if (!tx) {
      await this.prisma.$transaction(async (inner) =>
        this.releaseExpiredOrders(inner),
      );
      return;
    }

    const now = new Date();
    const candidates = await tx.order.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });
    if (candidates.length === 0) return;
    const candidateIds = candidates.map((o) => o.id);

    await tx.order.updateMany({
      where: { id: { in: candidateIds }, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });

    // Chỉ nhả kho của những đơn THỰC SỰ đang EXPIRED sau guard ở trên —
    // một đơn trong danh sách quét có thể vừa được thanh toán (webhook/polling)
    // giữa lúc quét và lúc update; nhả kho của đơn đó sẽ làm mất dòng đã bán.
    const expiredNow = await tx.order.findMany({
      where: { id: { in: candidateIds }, status: 'EXPIRED' },
      select: { id: true },
    });
    if (expiredNow.length === 0) return;
    const orderIds = expiredNow.map((o) => o.id);

    const orderItems = await tx.orderItem.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const orderItemIds = orderItems.map((i) => i.id);

    await tx.payment.updateMany({
      where: { orderId: { in: orderIds }, status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    if (orderItemIds.length > 0) {
      await tx.stockItem.updateMany({
        where: { status: 'RESERVED', orderItemId: { in: orderItemIds } },
        data: { status: 'AVAILABLE', orderItemId: null },
      });
    }
    await this.releaseCoupons(tx, orderIds);
  }

  /**
   * Trả lại lượt dùng mã giảm giá của các đơn vừa bị hủy/hết hạn — nếu không
   * mã sẽ "cạn" dần vì những đơn không bao giờ được thanh toán.
   */
  private async releaseCoupons(
    tx: Prisma.TransactionClient,
    orderIds: string[],
  ): Promise<void> {
    if (orderIds.length === 0) return;
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, couponId: { not: null } },
      select: { couponId: true },
    });
    for (const order of orders) {
      if (!order.couponId) continue;
      await tx.coupon.updateMany({
        where: { id: order.couponId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    }
  }

  /**
   * Đánh dấu đã thanh toán + giao hàng — idempotent nhờ guard
   * `updateMany { status IN (PENDING, EXPIRED) }`: lần gọi thứ hai
   * (webhook trùng, polling song song…) không làm gì thêm.
   */
  async markPaidAndDeliver(ref: {
    orderId?: string;
    merchantTradeNo?: string;
  }): Promise<MarkPaidResult | null> {
    let orderId = ref.orderId ?? null;
    if (!orderId && ref.merchantTradeNo) {
      const payment = await this.prisma.payment.findUnique({
        where: { merchantTradeNo: ref.merchantTradeNo },
        select: { orderId: true },
      });
      if (!payment) return null;
      orderId = payment.orderId;
    }
    if (!orderId) return null;

    const gate = await this.prisma.order.updateMany({
      where: { id: orderId, status: { in: ['PENDING', 'EXPIRED'] } },
      data: { status: 'PAID', paidAt: new Date() },
    });
    if (gate.count === 0) {
      // Đã được xử lý trước đó — trả về trạng thái hiện tại.
      const existing = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!existing) return null;
      return {
        status: existing.status,
        delivered: existing.status === 'DELIVERED',
      };
    }

    await this.prisma.payment.updateMany({
      where: { orderId },
      data: { status: 'SUCCESS' },
    });

    const delivered = await this.deliverOrder(orderId);
    return { status: delivered ? 'DELIVERED' : 'PAID', delivered };
  }

  /**
   * Giao hàng cho một đơn (đã PAID): dùng lại các dòng RESERVED của từng
   * order item; nếu thiếu (đơn từng hết hạn và kho đã bị nhả) thì khóa thêm
   * dòng AVAILABLE. Đủ toàn bộ số lượng → DELIVERED, thiếu → giữ PAID.
   * Idempotent: các dòng đã SOLD được tính trước, gọi lại không giao trùng.
   */
  async deliverOrder(orderId: string): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        /*
         * Khóa hàng Order TRƯỚC MỌI THỨ KHÁC. Hai lý do:
         *
         * 1. Chống giao gấp đôi. `alreadySold` được đọc rồi mới ghi ở dưới; nếu
         *    hai lần "giao lại" chạy song song (admin bấm hai lần, hai tab), cả
         *    hai cùng đọc alreadySold = 0, rồi `SKIP LOCKED` cấp cho mỗi bên một
         *    tập dòng kho KHÁC NHAU — khách nhận gấp đôi số key. Khóa ở đây bắt
         *    lần thứ hai phải xếp hàng, và khi tới lượt nó thấy hàng đã giao.
         *
         * 2. Thống nhất THỨ TỰ KHÓA. `releaseExpiredOrders` khóa Order rồi mới
         *    tới StockItem; nếu ở đây làm ngược lại thì hai bên ôm khóa của nhau
         *    và Postgres phải hủy một bên (deadlock).
         */
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;

        const items = await tx.orderItem.findMany({
          where: { orderId },
          orderBy: { id: 'asc' },
        });
        const now = new Date();
        let fullyDelivered = true;

        for (const item of items) {
          const alreadySold = await tx.stockItem.count({
            where: { orderItemId: item.id, status: 'SOLD' },
          });
          const needed = item.quantity - alreadySold;
          if (needed <= 0) continue;

          // FOR UPDATE: chặn releaseExpiredOrders nhả các dòng này giữa chừng —
          // sau khi giữ được khóa, Postgres re-check điều kiện RESERVED nên
          // dòng đã bị nhả trong lúc chờ sẽ tự bị loại và được bù bên dưới.
          const reserved = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "StockItem"
            WHERE "orderItemId" = ${item.id}
              AND "status" = 'RESERVED'::"StockStatus"
            ORDER BY "createdAt" ASC
            LIMIT ${needed}
            FOR UPDATE
          `;
          const ids = reserved.map((r) => r.id);

          // Loại sản phẩm có thể đã bị xóa (variantId = null) — khi đó không
          // còn kho để bù, đơn giữ nguyên trạng thái PAID.
          if (ids.length < needed && item.variantId) {
            const extra = await this.lockAvailableStock(
              tx,
              item.variantId,
              needed - ids.length,
            );
            ids.push(...extra);
          }

          if (ids.length > 0) {
            await tx.stockItem.updateMany({
              where: { id: { in: ids } },
              data: { status: 'SOLD', soldAt: now, orderItemId: item.id },
            });
          }
          if (alreadySold + ids.length < item.quantity) {
            fullyDelivered = false;
          }
        }

        if (fullyDelivered) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: 'DELIVERED' },
          });
        }
        return fullyDelivered;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Đóng đơn (webhook PAY_CLOSED / Binance báo CANCELED-EXPIRED):
   * đơn PENDING → EXPIRED, payment → EXPIRED, nhả kho RESERVED.
   */
  async expireOrder(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const gate = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      if (gate.count === 0) return;
      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      await this.releaseReservedStock(tx, orderId);
      await this.releaseCoupons(tx, [orderId]);
    });
  }

  /**
   * Hủy đơn nội bộ (Binance tạo phiên thất bại): đơn → CANCELLED,
   * payment → FAILED, nhả kho.
   */
  async cancelOrderInternal(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const gate = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (gate.count === 0) return;
      await tx.payment.updateMany({
        where: { orderId },
        data: { status: 'FAILED' },
      });
      await this.releaseReservedStock(tx, orderId);
      await this.releaseCoupons(tx, [orderId]);
    });
  }

  private async releaseReservedStock(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
      select: { id: true },
    });
    const ids = orderItems.map((i) => i.id);
    if (ids.length === 0) return;
    await tx.stockItem.updateMany({
      where: { status: 'RESERVED', orderItemId: { in: ids } },
      data: { status: 'AVAILABLE', orderItemId: null },
    });
  }
}
