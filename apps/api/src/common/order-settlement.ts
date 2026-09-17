import { InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { OrderStatus } from '@webcatt/shared';
import { K } from '../i18n/messages';

/**
 * Caller đã giữ lockFinancialArbitration trước mọi khóa dòng. Chỉ ghi CSDL
 * trong transaction của caller; giao hàng/thông báo phải đợi commit thành công.
 */
export async function markOrderPaid(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<{ status: OrderStatus; changed: boolean } | null> {
  const [order] = await tx.$queryRaw<Array<{
    status: OrderStatus;
    couponId: string | null;
    paidAt: Date | null;
  }>>`
    SELECT "status", "couponId", "paidAt" FROM "Order"
    WHERE "id" = ${orderId} FOR UPDATE
  `;
  if (!order) return null;
  if (order.status !== 'PENDING' && order.status !== 'EXPIRED') {
    return { status: order.status, changed: false };
  }

  const [payment] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE
  `;
  // Không còn Payment thì không được tạo một đơn PAID chỉ có nửa bằng chứng.
  if (!payment) throw new InternalServerErrorException(K.paymentSessionMissing);

  const changed = await tx.order.updateMany({
    where: { id: orderId, status: order.status },
    data: { status: 'PAID', paidAt: order.paidAt ?? new Date() },
  });
  if (changed.count === 0) return { status: order.status, changed: false };

  await tx.payment.updateMany({
    where: { id: payment.id, status: { not: 'SUCCESS' } },
    data: { status: 'SUCCESS' },
  });

  if (order.status === 'EXPIRED' && order.couponId) {
    // EXPIRED đã nhả lượt giữ chỗ. Tiền đến muộn vẫn phải được ghi nhận, kể cả
    // lượt trống đã cấp cho đơn khác: không áp maxUses/active ở đường nhận tiền.
    // CAS Order ở trên bảo đảm webhook phát lại không tăng coupon lần thứ hai.
    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${order.couponId} FOR UPDATE`;
    await tx.coupon.updateMany({
      where: { id: order.couponId },
      data: { usedCount: { increment: 1 } },
    });
  }
  return { status: 'PAID', changed: true };
}
