import type { Prisma } from '@prisma/client';

/** Caller giữ financial arbitration khi cấp amount mới. Không tái dùng số tiền
 * của chỉ dẫn đã hủy/hết hạn: một khoản muộn vẫn có thể thuộc về người cũ. */
export async function unresolvedUsdtAmounts(
  tx: Pick<Prisma.TransactionClient, 'paymentInstruction' | 'payment' | 'deposit'>,
): Promise<number[]> {
  const paymentScope: Prisma.PaymentWhereInput = {
    status: { not: 'SUCCESS' }, cryptoTxId: null, sepayRef: null,
    order: { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } },
  };
  const [instructions, deposits, legacy] = await Promise.all([
    tx.paymentInstruction.findMany({
      where: { mode: { in: ['CRYPTO', 'BINANCE_ID'] }, payment: paymentScope },
      select: { amount: true },
    }),
    tx.deposit.findMany({
      where: { mode: { in: ['CRYPTO', 'BINANCE_ID'] }, status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] }, cryptoTxId: null, sepayRef: null },
      select: { amountUsdt: true },
    }),
    tx.payment.findMany({
      where: { ...paymentScope, mode: { in: ['CRYPTO', 'BINANCE_ID'] }, cryptoAmount: { not: null } },
      select: { cryptoAmount: true },
    }),
  ]);
  return [
    ...instructions.map((row) => Number(row.amount)),
    ...deposits.map((row) => Number(row.amountUsdt)),
    ...legacy.map((row) => Number(row.cryptoAmount)),
  ];
}
