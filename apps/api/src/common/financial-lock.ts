import type { Prisma } from '@prisma/client';

/** Một namespace chung cho tập ứng viên và settlement, không phụ thuộc endpoint hay amount. */
const FINANCIAL_ARBITRATION = 0x43415454504159n;

export async function lockFinancialArbitration(tx: Prisma.TransactionClient): Promise<void> {
  // Phải lấy trước callback/allocation/Order: hai bảng unique riêng từng gây ghi cùng tiền hai lần.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${FINANCIAL_ARBITRATION})::text AS "locked"`;
}

export const FINANCIAL_TRANSACTION = { maxWait: 15_000, timeout: 15_000 } as const;
