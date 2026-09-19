import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CryptoNetwork } from '@webcatt/shared';
import { K } from '../i18n/messages';
import type { DepositMethod } from './balance.service';
import { paymentQuote } from '../orders/payment-discount';

export interface PreparedDeposit {
  readonly userId: string;
  readonly method: DepositMethod;
  readonly mode: 'SEPAY' | 'CRYPTO' | 'BINANCE_ID';
  readonly amountUsdt: Prisma.Decimal;
  readonly vndAmount: Prisma.Decimal;
  readonly cryptoNetwork: CryptoNetwork | null;
  readonly cryptoAddress: string;
  readonly bank: { accountNumber: string; bank: string; accountHolder: string } | null;
  readonly expireMinutes: number;
}

export interface BalancePaymentOptions {
  /** API kiểm lại SAU khóa User; settlement tiền đã nhận không dùng guard này. */
  requireUnlockedUser?: boolean;
}

export interface BalancePaymentResult {
  orderId: string;
  total: Prisma.Decimal;
  balanceAfter: Prisma.Decimal;
}

/** Caller giữ arbitration rồi Order/Payment → User → Stock, và phải để lỗi
 * thoát khỏi tx. Không giao hàng hoặc mở tx con: thiếu kho sau debit phải hoàn tác ví. */
export async function payOrderInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  orderId: string,
  options: BalancePaymentOptions = {},
): Promise<BalancePaymentResult> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findFirst({
    where: { id: orderId, userId },
  });
  if (!order) throw new NotFoundException(K.orderNotFound);
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" = ${orderId} FOR UPDATE`;
  const payment = await tx.payment.findUnique({ where: { orderId } });
  if (!payment || payment.status === 'SUCCESS' || payment.cryptoTxId || payment.sepayRef) {
    throw new BadRequestException(K.balanceOrderNotPending);
  }
  const quote = paymentQuote(order, 0);
  const gate = await tx.order.updateMany({
    where: { id: orderId, userId, status: 'PENDING' },
    data: { status: 'PAID', paidAt: new Date(), ...quote },
  });
  if (gate.count === 0) throw new BadRequestException(K.balanceOrderNotPending);

  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId }, select: { balance: true, lockedAt: true },
  });
  if (options.requireUnlockedUser && user.lockedAt) throw new ForbiddenException(K.accountLocked);
  if (user.balance.lessThan(quote.totalAmount)) throw new BadRequestException(K.balanceInsufficient);
  const balanceAfter = user.balance.sub(quote.totalAmount);
  await tx.user.update({ where: { id: userId }, data: { balance: balanceAfter } });
  await tx.balanceEntry.create({
    data: { userId, amount: quote.totalAmount.neg(), balanceAfter, reason: 'purchase', refCode: order.code },
  });
  const paid = await tx.payment.updateMany({
    where: { id: payment.id, orderId, status: payment.status, cryptoTxId: null, sepayRef: null },
    data: { status: 'SUCCESS', mode: 'BALANCE', amount: quote.totalAmount },
  });
  if (paid.count !== 1) throw new BadRequestException(K.balanceOrderNotPending);
  return { orderId, total: quote.totalAmount, balanceAfter };
}
