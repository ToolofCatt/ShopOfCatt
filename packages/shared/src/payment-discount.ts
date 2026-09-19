/** Chỉ phục vụ hiển thị. Máy chủ chốt tiền bằng Decimal trong transaction. */
export function previewPaymentDiscount(baseAmount: number, percent: number): { discount: number; total: number } {
  if (!Number.isFinite(baseAmount) || baseAmount < 0 || !Number.isFinite(percent) || percent < 0 || percent > 99) throw new Error('Invalid payment discount');
  const units = BigInt(Math.round(baseAmount * 1_000_000));
  const rate = BigInt(Math.round(percent * 100));
  const discount = units * rate / 10_000n;
  return { discount: Number(discount) / 1_000_000, total: Number(units - discount) / 1_000_000 };
}
