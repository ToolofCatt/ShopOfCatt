import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus, StockDrawMode } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { markOrderPaid } from '../common/order-settlement';

export interface MarkPaidResult {
  status: OrderStatus;
  delivered: boolean;
}

export interface ExpectedMerchantSession {
  merchantTradeNo: string;
  sessionVersion: number;
}

/**
 * Toàn bộ logic giữ kho / giao hàng / nhả kho — phần quan trọng nhất về
 * tính đúng đắn (concurrency-safe nhờ FOR UPDATE SKIP LOCKED + guard status).
 */
@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cách rút kho của sản phẩm chứa loại này. Đọc riêng một truy vấn nhỏ thay vì
   * JOIN vào truy vấn khóa bên dưới: `FOR UPDATE` trên câu có JOIN sẽ khóa luôn
   * cả hàng Product và ProductVariant, biến mọi đơn của cùng một sản phẩm thành
   * xếp hàng nối đuôi nhau.
   */
  private async getDrawMode(
    tx: Prisma.TransactionClient,
    variantId: string,
  ): Promise<StockDrawMode> {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { product: { select: { stockDrawMode: true } } },
    });
    return variant?.product.stockDrawMode ?? 'SEQUENTIAL';
  }

  /**
   * Khóa (lock) các dòng kho AVAILABLE của một loại sản phẩm — bỏ qua các dòng
   * đang bị transaction khác giữ (SKIP LOCKED).
   */
  async lockAvailableStock(
    tx: Prisma.TransactionClient,
    variantId: string,
    limit: number,
    /**
     * Ép thứ tự rút cho LƯỢT NÀY, bỏ qua cấu hình của sản phẩm.
     *
     * Có để chủ shop tự rút kho chọn được thứ tự ngay lúc rút, mà vẫn đi qua
     * đúng truy vấn `FOR UPDATE SKIP LOCKED` này — nếu viết một truy vấn riêng
     * cho việc rút tay thì lượt rút và một đơn của khách có thể cùng lấy một
     * dòng, và khách trả tiền xong mới biết key đã bị thu hồi.
     */
    drawModeOverride?: StockDrawMode,
  ): Promise<string[]> {
    if (limit <= 0) return [];
    const drawMode = drawModeOverride ?? (await this.getDrawMode(tx, variantId));

    /*
     * Chỉ mệnh đề ORDER BY thay đổi; phần còn lại — nhất là FOR UPDATE SKIP
     * LOCKED — giữ nguyên một bản duy nhất, để không có đường nào chạy mà thiếu
     * khóa. Hai nhánh đều là chuỗi HẰNG viết sẵn tại đây, không nhận dữ liệu
     * ngoài, nên `Prisma.sql` ở đây không mở đường tiêm SQL.
     *
     * SEQUENTIAL kèm "id" ASC làm khóa phụ: kho nạp bằng `createMany` nên MỌI
     * key dán cùng một lần có `createdAt` giống hệt nhau (Postgres lấy mốc thời
     * gian của transaction). Chỉ sắp theo createdAt thì thứ tự giữa chúng là do
     * Postgres tùy nghi — tức "tuần tự" không thật sự tuần tự. cuid tăng dần
     * theo thời gian tạo nên nó khôi phục đúng thứ tự dán vào.
     */
    const thuTu =
      drawMode === 'RANDOM'
        ? Prisma.sql`random()`
        : Prisma.sql`"createdAt" ASC, "id" ASC`;

    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "StockItem"
      WHERE "variantId" = ${variantId}
        AND "status" = 'AVAILABLE'::"StockStatus"
      ORDER BY ${thuTu}
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    return rows.map((row) => row.id);
  }

  /**
   * Nhả các đơn PENDING đã quá hạn: đơn → EXPIRED, payment → EXPIRED,
   * kho RESERVED → AVAILABLE.
   */
  async releaseExpiredOrders(tx?: Prisma.TransactionClient): Promise<void> {
    if (!tx) {
      await this.prisma.$transaction(
        async (inner) => this.releaseExpiredOrders(inner),
        // Lượt quét có thể phải xếp sau giao hàng đang giữ khóa Order. Chờ có
        // giới hạn thay vì vỡ ở maxWait mặc định trước khi Postgres xử lý khóa.
        { maxWait: 15_000, timeout: 15_000 },
      );
      return;
    }

    await lockFinancialArbitration(tx);
    const now = new Date();
    // Đọc ứng viên SAU arbitration. Bản cũ đọc cùng snapshot rồi tìm lại mọi
    // EXPIRED nên sweep thua cũng trừ coupon của đơn đã được sweep thắng nhả.
    // Prisma giữ timestamp UTC đúng kiểu cột; raw Date có thể bị ép timestamptz
    // và chọn nhầm đơn còn hạn nếu PostgreSQL chạy ở múi giờ địa phương.
    const candidates = await tx.order.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const orderIds: string[] = [];
    for (const candidate of candidates) {
      if (await this.closePendingOrder(tx, candidate.id, 'EXPIRED')) {
        orderIds.push(candidate.id);
      }
    }
    if (orderIds.length === 0) return;

    // Chỉ trả tài nguyên cho CAS thắng trong CHÍNH transaction này; Coupon
    // trước Stock để không đảo khóa với reservation lúc tạo đơn.
    await this.releaseCoupons(tx, orderIds);
    for (const orderId of orderIds) await this.releaseReservedStock(tx, orderId);
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
    const releases = new Map<string, number>();
    for (const order of orders) {
      if (order.couponId) {
        releases.set(order.couponId, (releases.get(order.couponId) ?? 0) + 1);
      }
    }
    for (const couponId of [...releases.keys()].sort()) {
      // Cùng thứ tự Coupon ở mọi batch; GREATEST chỉ bảo vệ dữ liệu legacy âm,
      // không được dùng để che double-release (orderIds chỉ chứa CAS thắng).
      await tx.$executeRaw`
        UPDATE "Coupon"
        SET "usedCount" = GREATEST(0, "usedCount" - ${releases.get(couponId)!}),
            "updatedAt" = NOW()
        WHERE "id" = ${couponId}
      `;
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

    const targetId = orderId;
    const settled = await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      return markOrderPaid(tx, targetId);
    }, FINANCIAL_TRANSACTION);
    if (!settled) return null;
    if (!settled.changed) {
      return {
        status: settled.status,
        delivered: settled.status === 'DELIVERED',
      };
    }

    // Không giao trước commit: lỗi ghi Payment phải rollback luôn Order/coupon.
    const delivered = await this.deliverOrder(targetId);
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
        const [order] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`
          SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
        `;
        if (!order || (order.status !== 'PAID' && order.status !== 'DELIVERED')) return false;
        if (order.status === 'DELIVERED') return true;

        const items = await tx.orderItem.findMany({
          where: { orderId },
          orderBy: { id: 'asc' },
        });
        const variantIds = [...new Set(items.flatMap((item) => item.variantId ? [item.variantId] : []))].sort();
        if (variantIds.length > 0) {
          // Chặn xóa loại trước khi chạm kho nhưng tương thích khóa FK của import.
          // FOR UPDATE ở đây sẽ tạo vòng Variant ↔ Stock với writer giữ Stock
          // rồi kiểm FK; lấy tất cả variant theo id trước khi lấy dòng kho đầu.
          await tx.$queryRaw(Prisma.sql`
            SELECT "id" FROM "ProductVariant" WHERE "id" IN (${Prisma.join(variantIds)})
            ORDER BY "id" FOR KEY SHARE
          `);
        }
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
            ORDER BY "createdAt" ASC, "id" ASC
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
          await tx.order.updateMany({
            where: { id: orderId, status: 'PAID' },
            data: { status: 'DELIVERED' },
          });
        }
        return fullyDelivered;
      },
      // Nhiều webhook/tick có thể cùng gọi giao một đơn. Chúng phải xếp hàng ở
      // khóa Order và đọc lại trạng thái, không được rơi trước khi vào transaction.
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  /**
   * Đóng đơn (webhook PAY_CLOSED / Binance báo CANCELED-EXPIRED):
   * đơn PENDING → EXPIRED, payment → EXPIRED, nhả kho RESERVED.
   */
  async expireOrder(
    orderId: string,
    expectedPayment?: ExpectedMerchantSession,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      if (!(await this.closePendingOrder(tx, orderId, 'EXPIRED', expectedPayment))) return;
      await this.releaseCoupons(tx, [orderId]);
      await this.releaseReservedStock(tx, orderId);
    }, FINANCIAL_TRANSACTION);
  }

  /**
   * Hủy đơn nội bộ (Binance tạo phiên thất bại): đơn → CANCELLED,
   * payment → FAILED, nhả kho.
   */
  async cancelOrderInternal(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      if (!(await this.closePendingOrder(tx, orderId, 'CANCELLED'))) return;
      await this.releaseCoupons(tx, [orderId]);
      await this.releaseReservedStock(tx, orderId);
    }, FINANCIAL_TRANSACTION);
  }

  /** Trả true chỉ khi transaction này thật sự đóng PENDING và được quyền nhả. */
  private async closePendingOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: 'EXPIRED' | 'CANCELLED',
    expectedPayment?: ExpectedMerchantSession,
  ): Promise<boolean> {
    const [order] = await tx.$queryRaw<Array<{ status: OrderStatus }>>`
      SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
    `;
    if (order?.status !== 'PENDING') return false;
    const [payment] = await tx.$queryRaw<Array<{
      status: string;
      mode: string;
      merchantTradeNo: string;
      sessionVersion: number;
    }>>`
      SELECT "status", "mode", "merchantTradeNo", "sessionVersion"
      FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE
    `;
    // Poll/webhook có thể đọc phiên cũ rồi chờ đổi phương thức commit. Kiểm
    // lại đủ mode/ref/version DƯỚI khóa để không nhả kho của phiên mới.
    if (expectedPayment && (
      payment?.mode !== 'BINANCE' ||
      payment.merchantTradeNo !== expectedPayment.merchantTradeNo ||
      payment.sessionVersion !== expectedPayment.sessionVersion
    )) return false;
    if (payment?.status === 'SUCCESS') {
      // Legacy từng commit Payment trước Order: không biến khoản tiền đã nhận
      // thành FAILED và trả key/coupon cho người khác khi đóng đơn bị lệch.
      await markOrderPaid(tx, orderId);
      return false;
    }
    const changed = await tx.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status },
    });
    if (changed.count === 0) return false;
    await tx.payment.updateMany({
      where: { orderId, status: { not: 'SUCCESS' } },
      data: { status: status === 'CANCELLED' ? 'FAILED' : 'EXPIRED' },
    });
    return true;
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
