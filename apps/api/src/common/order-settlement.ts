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
  options: { allowCouponOveruse?: boolean } = {},
): Promise<{ status: OrderStatus; changed: boolean; couponConflict?: boolean } | null> {
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

  const [payment] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status" FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE
  `;
  // Không còn Payment thì không được tạo một đơn PAID chỉ có nửa bằng chứng.
  if (!payment) throw new InternalServerErrorException(K.paymentSessionMissing);

  if (payment.status !== 'SUCCESS' && !options.allowCouponOveruse && await expiredCouponConflict(tx, orderId)) {
    return { status: 'EXPIRED', changed: false, couponConflict: true };
  }

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
    // Khoản muộn vượt quota đã được chặn để đối soát; operator có thể ghi đè
    // thủ công sau khi kiểm tra transfer và chấp nhận vượt quota.
    // CAS Order ở trên bảo đảm webhook phát lại không tăng coupon lần thứ hai.
    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${order.couponId} FOR UPDATE`;
    await tx.coupon.updateMany({
      where: { id: order.couponId },
      data: { usedCount: { increment: 1 } },
    });
  }
  return { status: 'PAID', changed: true };
}

/** Caller giữ arbitration; khóa coupon cho tới khi Order đổi trạng thái. */
export async function expiredCouponConflict(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { status: true, couponId: true, userId: true } });
  if (order?.status !== 'EXPIRED' || !order.couponId) return false;
  await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${order.couponId} FOR UPDATE`;
  const coupon = await tx.coupon.findUnique({ where: { id: order.couponId }, select: { maxUses: true, usedCount: true, perUserLimit: true } });
  if (!coupon) return true;
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return true;
  if (coupon.perUserLimit !== null) {
    const used = await tx.order.count({ where: { userId: order.userId, couponId: order.couponId, status: { in: ['PENDING', 'PAID', 'DELIVERED'] } } });
    if (used >= coupon.perUserLimit) return true;
  }
  return false;
}
