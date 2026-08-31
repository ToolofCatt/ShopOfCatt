import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const gate = await tx.deposit.updateMany({
          where: {
            id: depositId,
            status: { in: ['PENDING', 'EXPIRED'] },
            // Một mã nạp chỉ nhận đúng MỘT giao dịch, bất kể kênh nào.
            sepayRef: null,
            cryptoTxId: null,
          },
          data: { status: 'SUCCESS', paidAt: new Date(), ...ref },
        });
          if (gate.count === 0) return false;

          const deposit = await tx.deposit.findUniqueOrThrow({
          where: { id: depositId },
          select: { userId: true, amountUsdt: true, code: true },
        });

        /*
         * Khoá dòng User trước khi đọc-cộng: không khoá thì hai lần cộng/trừ
         * song song cùng đọc một số dư cũ và balanceAfter trong sổ cái nói dối.
         */
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${deposit.userId} FOR UPDATE`;
          const user = await tx.user.findUniqueOrThrow({
          where: { id: deposit.userId },
          select: { balance: true },
        });
          const balanceAfter = user.balance.add(deposit.amountUsdt);
          await tx.user.update({
          where: { id: deposit.userId },
          data: { balance: balanceAfter },
        });
          await tx.balanceEntry.create({
          data: {
            userId: deposit.userId,
            amount: deposit.amountUsdt,
            balanceAfter,
            reason: 'deposit',
            refCode: deposit.code,
          },
        });
          return true;
        },
        // Hai webhook/tick cùng nhắm một mã phải CHỜ trọng tài hàng Deposit,
        // không được vỡ vì maxWait 2 giây mặc định trước khi CAS trả false.
        { maxWait: 10_000, timeout: 10_000 },
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Bên kia vừa ghi cùng ref — coi như đã xử lý.
        return false;
      }
      throw err;
    }
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
