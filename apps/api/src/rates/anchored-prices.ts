import { Prisma } from '@prisma/client';

/**
 * Dùng chung cho tỉ giá nhập tay và tự động, luôn nhận transaction của caller.
 * PostgreSQL numeric + FLOOR giữ đủ sáu chữ số mà không đẩy giá neo 100.000 ₫
 * thành 100.001 ₫ khi frontend làm tròn lên. USD/USDT và giá đơn đã chốt giữ nguyên.
 */
export async function recalculateAnchoredPrices(
  tx: Prisma.TransactionClient,
  vndPerUsdt: Prisma.Decimal | number,
  cnyPerUsdt: Prisma.Decimal | number,
): Promise<void> {
  for (const [currency, rate] of [['VND', vndPerUsdt], ['CNY', cnyPerUsdt]] as const) {
    const value = new Prisma.Decimal(rate);
    // Tỉ giá 0 có nghĩa tắt quy đổi, không được chia cho 0 hoặc xoá giá đang bán.
    if (!value.gt(0)) continue;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ProductVariant"
      SET "price" = FLOOR("priceAmount" / ${value} * 1000000) / 1000000
      WHERE "priceCurrency" = ${currency}
    `);
  }
}
