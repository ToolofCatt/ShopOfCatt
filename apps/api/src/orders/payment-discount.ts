import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentMethod } from '@webcatt/shared';
import { K } from '../i18n/messages';

export const DISCOUNT_METHODS = ['binance_pay','binance_id','sepay','crypto_bep20','crypto_trc20'] as const;
export function parsePaymentDiscounts(raw: unknown): Partial<Record<PaymentMethod,number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException(K.paymentDiscountInvalid);
  const values: Partial<Record<PaymentMethod,number>> = {};
  for (const [method,value] of Object.entries(raw)) {
    if (!(DISCOUNT_METHODS as readonly string[]).includes(method) || typeof value !== 'number' || !Number.isFinite(value)
      || value < 0 || value > 99 || !new Prisma.Decimal(value).mul(100).isInteger()) throw new BadRequestException(K.paymentDiscountInvalid);
    values[method as PaymentMethod] = value;
  }
  return values;
}

/** Tính lại từ tiền đơn đã chốt, bỏ ưu đãi phương thức cũ trước khi áp mới. */
export function paymentQuote(order: {subtotalAmount: Prisma.Decimal; discountAmount: Prisma.Decimal; paymentDiscountAmount: Prisma.Decimal}, percent: number) {
  const couponDiscount = order.discountAmount.sub(order.paymentDiscountAmount);
  const base = order.subtotalAmount.sub(couponDiscount);
  const paymentDiscountAmount = base.mul(percent).div(100).toDecimalPlaces(6, Prisma.Decimal.ROUND_DOWN);
  return { totalAmount: base.sub(paymentDiscountAmount), discountAmount: couponDiscount.add(paymentDiscountAmount), paymentDiscountAmount, paymentDiscountPercent: new Prisma.Decimal(percent) };
}
