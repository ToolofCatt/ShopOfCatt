import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CryptoNetwork } from '@webcatt/shared';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import {
  matchDeposits,
  type BinanceDeposit,
  type PendingCryptoPayment,
} from '../binance-exchange/deposit-matcher';
import {
  matchPayTransfers,
  type BinancePayTransfer,
  type PendingPayPayment,
} from '../binance-exchange/pay-matcher';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FulfillmentService } from './fulfillment.service';

/** Chu kỳ đối soát nền. */
const TICK_MS = 60_000;

/** Khoản nạp được tính từ trước khi tạo đơn tối đa 10 phút (đồng bộ với matcher). */
const CRYPTO_SLACK_MS = 10 * 60_000;

/**
 * Đối soát nền: mỗi 60 giây quét mọi đơn CRYPTO đang chờ, gọi MỘT lần lịch sử
 * nạp Binance rồi khớp tất cả — khách được giao hàng dù không mở trang thanh toán.
 * KHÔNG BAO GIỜ ném lỗi; tick đang chạy thì tick mới bỏ qua (chống chồng lấn).
 */
@Injectable()
export class CryptoReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CryptoReconcileService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly binanceExchange: BinanceExchangeService,
    private readonly fulfillment: FulfillmentService,
    private readonly settings: SettingsService,
    private readonly walletCredit: WalletCreditService,
  ) {}

  onModuleInit(): void {
    if (!this.binanceExchange.isConfigured) {
      this.logger.log(
        'BINANCE_API_KEY chưa cấu hình — bỏ qua đối soát crypto nền',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Không giữ tiến trình sống chỉ vì timer này.
    this.timer.unref?.();
    this.logger.log(`Đối soát crypto nền: bật (mỗi ${TICK_MS / 1000} giây)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Một vòng đối soát. Public để có thể gọi chủ động khi cần. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickCrypto();
      await this.tickBinanceId();
    } catch (error) {
      this.logger.warn(
        `Vòng đối soát thất bại: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Trong các mã giao dịch của `txIds`, mã nào đã được ghi cho MỘT ĐƠN hoặc
   * MỘT MÃ NẠP — một khoản tiền không bao giờ vừa giao hàng vừa cộng ví.
   * Truy vấn theo `in` thay vì tải toàn bộ: chi phí bám theo lịch sử vừa tải,
   * không phình theo tổng số đơn đã bán.
   */
  private async usedAcrossTables(txIds: string[]): Promise<Set<string>> {
    if (txIds.length === 0) return new Set();
    const [donRows, napUsed] = await Promise.all([
      this.prisma.payment.findMany({
        where: { cryptoTxId: { in: txIds } },
        select: { cryptoTxId: true },
      }),
      this.walletCredit.usedTxIds(txIds),
    ]);
    return new Set([
      ...donRows.map((row) => row.cryptoTxId as string),
      ...napUsed,
    ]);
  }

  /** Đơn + MÃ NẠP VÍ USDT on-chain — khớp với lịch sử NẠP trong cùng một tick,
   *  chung một bảng txId đã dùng, để hai bên không bao giờ giành nhau một khoản. */
  private async tickCrypto(): Promise<void> {
    const payments = await this.prisma.payment.findMany({
      where: {
        mode: 'CRYPTO',
        status: 'PENDING',
        cryptoNetwork: { not: null },
        cryptoAmount: { not: null },
        order: { status: 'PENDING' },
      },
      select: {
        id: true,
        orderId: true,
        cryptoNetwork: true,
        cryptoAmount: true,
        order: { select: { code: true, createdAt: true } },
      },
    });
    const naps = await this.walletCredit.listAwaiting('CRYPTO');
    if (payments.length === 0 && naps.length === 0) return;

    const oldestMs = Math.min(
      ...payments.map((p) => p.order.createdAt.getTime()),
      ...naps.map((n) => n.createdAtMs),
    );
    const deposits = await this.binanceExchange.listUsdtDeposits(
      oldestMs - CRYPTO_SLACK_MS,
    );
    const usedTxIds = await this.usedAcrossTables(deposits.map((d) => d.txId));

    // ĐƠN trước, MÃ NẠP sau — cùng thứ tự ở mọi nơi để kết quả ổn định; các
    // mã giao dịch đơn vừa nhận được đưa vào used trước khi khớp mã nạp.
    await this.matchCryptoOrders(payments, deposits, usedTxIds);
    await this.creditCryptoDeposits(naps, deposits, usedTxIds);
  }

  private async matchCryptoOrders(
    payments: {
      id: string;
      orderId: string;
      cryptoNetwork: string | null;
      cryptoAmount: Prisma.Decimal | null;
      order: { code: string; createdAt: Date };
    }[],
    deposits: BinanceDeposit[],
    usedTxIds: Set<string>,
  ): Promise<void> {
    if (payments.length === 0) return;
    const pending: PendingCryptoPayment[] = payments.map((p) => ({
      orderId: p.orderId,
      network: p.cryptoNetwork as CryptoNetwork,
      expected: Number(p.cryptoAmount),
      createdAtMs: p.order.createdAt.getTime(),
    }));

    const matches = matchDeposits(pending, deposits, usedTxIds);
    for (const match of matches) {
      const payment = payments.find((p) => p.orderId === match.orderId);
      if (!payment) continue;
      try {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { cryptoTxId: match.txId, status: 'SUCCESS' },
        });
      } catch (error) {
        // P2002: một tiến trình/luồng khác vừa nhận chính khoản nạp này.
        // Ràng buộc @unique là trọng tài — bỏ qua, không giao hàng hai lần.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          this.logger.warn(
            `Bỏ qua tx ${match.txId}: đã được ghi nhận cho đơn khác`,
          );
          continue;
        }
        throw error;
      }
      usedTxIds.add(match.txId);
      await this.fulfillment.markPaidAndDeliver({ orderId: match.orderId });
      this.logger.log(
        `Đối soát nền: đã khớp đơn ${payment.order.code} với ${match.amount} USDT (${match.network}, tx ${match.txId})`,
      );
    }
  }

  /** Cộng ví các mã nạp on-chain khớp được — cùng bộ matchDeposits với đơn. */
  private async creditCryptoDeposits(
    naps: {
      id: string;
      code: string;
      amountUsdt: number;
      cryptoNetwork: string | null;
      createdAtMs: number;
    }[],
    deposits: BinanceDeposit[],
    usedTxIds: Set<string>,
  ): Promise<void> {
    if (naps.length === 0) return;
    const pending: PendingCryptoPayment[] = naps
      .filter((n) => n.cryptoNetwork !== null)
      .map((n) => ({
        orderId: n.id, // matcher gọi là orderId nhưng chỉ là id tham chiếu
        network: n.cryptoNetwork as CryptoNetwork,
        expected: n.amountUsdt,
        createdAtMs: n.createdAtMs,
      }));

    const matches = matchDeposits(pending, deposits, usedTxIds);
    for (const match of matches) {
      const nap = naps.find((n) => n.id === match.orderId);
      if (!nap) continue;
      // credit tự chống trùng bằng gate + @unique; false = bên khác đã xử lý.
      const daCong = await this.walletCredit.credit(nap.id, {
        cryptoTxId: match.txId,
      });
      usedTxIds.add(match.txId);
      if (daCong) {
        this.logger.log(
          `Đối soát nền: đã cộng ví mã nạp ${nap.code} — ${match.amount} USDT (${match.network}, tx ${match.txId})`,
        );
      }
    }
  }

  /**
   * Đơn chuyển tới Binance ID — khớp với lịch sử BINANCE PAY.
   *
   * Tách riêng khỏi vòng on-chain vì hai nguồn dữ liệu khác nhau: một bên là
   * lịch sử nạp on-chain, một bên là lịch sử Pay nội bộ. Lỗi ở nguồn này không
   * được làm hỏng việc đối soát của nguồn kia.
   */
  private async tickBinanceId(): Promise<void> {
    const payments = await this.prisma.payment.findMany({
      where: {
        mode: 'BINANCE_ID',
        status: 'PENDING',
        cryptoAmount: { not: null },
        order: { status: 'PENDING' },
      },
      select: {
        id: true,
        orderId: true,
        cryptoAmount: true,
        order: { select: { code: true, createdAt: true } },
      },
    });
    const naps = await this.walletCredit.listAwaiting('BINANCE_ID');
    if (payments.length === 0 && naps.length === 0) return;

    const oldestMs = Math.min(
      ...payments.map((p) => p.order.createdAt.getTime()),
      ...naps.map((n) => n.createdAtMs),
    );
    const transfers = await this.binanceExchange.listPayTransactions(
      oldestMs - CRYPTO_SLACK_MS,
    );
    const used = await this.usedAcrossTables(
      transfers.map((t) => t.transactionId),
    );
    const receiverBinanceId = await this.settings.getBinanceId();

    await this.matchPayOrders(payments, transfers, used, receiverBinanceId);
    await this.creditPayDeposits(naps, transfers, used, receiverBinanceId);
  }

  private async matchPayOrders(
    payments: {
      id: string;
      orderId: string;
      cryptoAmount: Prisma.Decimal | null;
      order: { code: string; createdAt: Date };
    }[],
    transfers: BinancePayTransfer[],
    used: Set<string>,
    receiverBinanceId: string,
  ): Promise<void> {
    if (payments.length === 0) return;
    const pending: PendingPayPayment[] = payments.map((p) => ({
      orderId: p.orderId,
      code: p.order.code,
      expected: Number(p.cryptoAmount),
      createdAtMs: p.order.createdAt.getTime(),
    }));

    const matches = matchPayTransfers(pending, transfers, used, {
      receiverBinanceId,
    });
    for (const match of matches) {
      const payment = payments.find((p) => p.orderId === match.orderId);
      if (!payment) continue;
      try {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { cryptoTxId: match.transactionId, status: 'SUCCESS' },
        });
      } catch (error) {
        // Cùng hàng rào @unique như bên on-chain: mã giao dịch đã ghi nhận cho
        // đơn khác thì bỏ qua, tuyệt đối không giao hàng hai lần.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          this.logger.warn(
            `Bỏ qua giao dịch Pay ${match.transactionId}: đã ghi nhận cho đơn khác`,
          );
          continue;
        }
        throw error;
      }
      used.add(match.transactionId);
      await this.fulfillment.markPaidAndDeliver({ orderId: match.orderId });
      this.logger.log(
        `Đối soát Binance Pay: đã khớp đơn ${payment.order.code} với ${match.amount} USDT ` +
          `(giao dịch ${match.transactionId}, khớp theo ${match.by === 'memo' ? 'ghi chú' : 'số tiền'})`,
      );
    }
  }

  /** Cộng ví các mã nạp Binance ID — khách ghi mã NAP- vào lời nhắn là khớp
   *  chắc; quên ghi thì chỉ khớp khi duy nhất một khoản cùng số tiền. */
  private async creditPayDeposits(
    naps: {
      id: string;
      code: string;
      amountUsdt: number;
      createdAtMs: number;
    }[],
    transfers: BinancePayTransfer[],
    used: Set<string>,
    receiverBinanceId: string,
  ): Promise<void> {
    if (naps.length === 0) return;
    const pending: PendingPayPayment[] = naps.map((n) => ({
      orderId: n.id, // matcher gọi là orderId nhưng chỉ là id tham chiếu
      code: n.code,
      expected: n.amountUsdt,
      createdAtMs: n.createdAtMs,
    }));

    const matches = matchPayTransfers(pending, transfers, used, {
      receiverBinanceId,
    });
    for (const match of matches) {
      const nap = naps.find((n) => n.id === match.orderId);
      if (!nap) continue;
      const daCong = await this.walletCredit.credit(nap.id, {
        cryptoTxId: match.transactionId,
      });
      used.add(match.transactionId);
      if (daCong) {
        this.logger.log(
          `Đối soát Binance Pay: đã cộng ví mã nạp ${nap.code} — ${match.amount} USDT ` +
            `(giao dịch ${match.transactionId}, khớp theo ${match.by === 'memo' ? 'ghi chú' : 'số tiền'})`,
        );
      }
    }
  }
}
