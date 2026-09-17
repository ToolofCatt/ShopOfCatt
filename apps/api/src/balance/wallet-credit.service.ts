import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { creditDepositTransfer, observeTransfer, type TransferFacts } from '../common/incoming-transfer';

/** Mã nạp crypto quá 24 giờ thì thôi không đối soát nữa — xem listAwaiting. */
const CRYPTO_AWAIT_HOURS = 24;

/**
 * Cộng tiền vào ví cho một mã nạp đã khớp giao dịch — TÁCH riêng khỏi
 * BalanceService để vòng đối soát crypto (nằm trong OrdersModule) dùng được
 * mà không tạo vòng import OrdersModule ⇄ BalanceModule.
 *
 * Đây là chỗ DUY NHẤT ghi SUCCESS cho Deposit — webhook SePay đi qua
 * BalanceService.creditDeposit cũng chỉ là uỷ quyền xuống đây.
 */
@Injectable()
export class WalletCreditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cộng tiền một mã nạp. Idempotent hai lớp: guard trạng thái (updateMany
   * điều kiện cả hai cột ref còn trống) + `sepayRef`/`cryptoTxId` @unique —
   * webhook trùng, hai tiến trình đua, hay một giao dịch bị khai cho hai mã
   * thì chỉ một bên cộng được.
   */
  async credit(
    depositId: string,
    ref: { sepayRef: string } | { cryptoTxId: string },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!deposit) return false;
      const sepay = 'sepayRef' in ref;
      const source: TransferFacts['source'] = sepay ? 'SEPAY'
        : deposit.mode === 'BINANCE_ID' ? 'BINANCE_ID'
        : deposit.cryptoNetwork === 'BEP20' ? 'CRYPTO:BEP20' : 'CRYPTO:TRC20';
      if (!sepay && deposit.mode !== 'BINANCE_ID' && !['BEP20', 'TRC20'].includes(deposit.cryptoNetwork ?? '')) return false;
      const transfer = await observeTransfer(tx, {
        source, reference: sepay ? ref.sepayRef : ref.cryptoTxId,
        amount: sepay ? deposit.vndAmount : deposit.amountUsdt,
        currency: sepay ? 'VND' : 'USDT', network: deposit.cryptoNetwork, receiver: deposit.cryptoAddress,
      });
      return creditDepositTransfer(tx, depositId, transfer);
    }, FINANCIAL_TRANSACTION);
  }

  /**
   * Mã nạp crypto/Binance ID đang chờ tiền — cho vòng đối soát nền.
   *
   * Nhận cả EXPIRED chưa có ref (tiền về muộn vẫn phải cộng — cùng luật với
   * kênh SePay), nhưng CHẶN ở 24 giờ: kênh này là poll chứ không phải webhook,
   * không chặn là cửa sổ lịch sử phải tải từ Binance phình mãi theo thời gian.
   */
  async listAwaiting(mode: 'CRYPTO' | 'BINANCE_ID'): Promise<
    {
      id: string;
      code: string;
      amountUsdt: number;
      cryptoNetwork: string | null;
      createdAtMs: number;
    }[]
  > {
    const rows = await this.prisma.deposit.findMany({
      where: {
        mode,
        status: { in: ['PENDING', 'EXPIRED'] },
        sepayRef: null,
        cryptoTxId: null,
        createdAt: { gt: new Date(Date.now() - CRYPTO_AWAIT_HOURS * 3_600_000) },
      },
      select: {
        id: true,
        code: true,
        amountUsdt: true,
        cryptoNetwork: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      amountUsdt: Number(row.amountUsdt),
      cryptoNetwork: row.cryptoNetwork,
      createdAtMs: row.createdAt.getTime(),
    }));
  }

  /** Trong `txIds`, những mã giao dịch đã được MỘT MÃ NẠP nhận rồi. */
  async usedTxIds(txIds: string[]): Promise<Set<string>> {
    if (txIds.length === 0) return new Set();
    const rows = await this.prisma.deposit.findMany({
      where: { cryptoTxId: { in: txIds } },
      select: { cryptoTxId: true },
    });
    return new Set(rows.map((row) => row.cryptoTxId as string));
  }

  /**
   * Số USDT các khoản ĐANG CHỜ trên hai kênh crypto (cả mã nạp lẫn đơn hàng)
   * — để mã nạp mới chọn được số tiền không đụng ai. Xem unique-amount.ts.
   */
  async takenUsdtAmounts(
    client: Pick<Prisma.TransactionClient, 'deposit' | 'payment'> = this.prisma,
  ): Promise<number[]> {
    const [naps, dons] = await Promise.all([
      client.deposit.findMany({
        where: {
          mode: { in: ['CRYPTO', 'BINANCE_ID'] },
          status: { in: ['PENDING', 'EXPIRED'] },
          cryptoTxId: null,
          createdAt: {
            gt: new Date(Date.now() - CRYPTO_AWAIT_HOURS * 3_600_000),
          },
        },
        select: { amountUsdt: true },
      }),
      client.payment.findMany({
        where: {
          mode: { in: ['CRYPTO', 'BINANCE_ID'] },
          status: 'PENDING',
          cryptoAmount: { not: null },
          order: { status: 'PENDING' },
        },
        select: { cryptoAmount: true },
      }),
    ]);
    return [
      ...naps.map((row) => Number(row.amountUsdt)),
      ...dons.map((row) => Number(row.cryptoAmount)),
    ];
  }
}
