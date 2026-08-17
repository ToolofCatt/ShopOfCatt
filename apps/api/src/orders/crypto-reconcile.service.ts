import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CryptoNetwork } from '@webcatt/shared';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import {
  matchDeposits,
  type PendingCryptoPayment,
} from '../binance-exchange/deposit-matcher';
import {
  matchPayTransfers,
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

  /** Đơn USDT on-chain — khớp với lịch sử NẠP. */
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
    if (payments.length === 0) return;

    const oldestMs = Math.min(
      ...payments.map((p) => p.order.createdAt.getTime()),
    );
    const deposits = await this.binanceExchange.listUsdtDeposits(
      oldestMs - CRYPTO_SLACK_MS,
    );

    const usedRows = await this.prisma.payment.findMany({
      where: { cryptoTxId: { not: null } },
      select: { cryptoTxId: true },
    });
    const usedTxIds = new Set(usedRows.map((row) => row.cryptoTxId as string));

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
      await this.fulfillment.markPaidAndDeliver({ orderId: match.orderId });
      this.logger.log(
        `Đối soát nền: đã khớp đơn ${payment.order.code} với ${match.amount} USDT (${match.network}, tx ${match.txId})`,
      );
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
    if (payments.length === 0) return;

    const oldestMs = Math.min(
      ...payments.map((p) => p.order.createdAt.getTime()),
    );
    const transfers = await this.binanceExchange.listPayTransactions(
      oldestMs - CRYPTO_SLACK_MS,
    );

    const usedRows = await this.prisma.payment.findMany({
      where: { cryptoTxId: { not: null } },
      select: { cryptoTxId: true },
    });
    const used = new Set(usedRows.map((row) => row.cryptoTxId as string));

    const pending: PendingPayPayment[] = payments.map((p) => ({
      orderId: p.orderId,
      expected: Number(p.cryptoAmount),
      createdAtMs: p.order.createdAt.getTime(),
    }));

    const matches = matchPayTransfers(pending, transfers, used, {
      receiverBinanceId: await this.settings.getBinanceId(),
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
      await this.fulfillment.markPaidAndDeliver({ orderId: match.orderId });
      this.logger.log(
        `Đối soát Binance Pay: đã khớp đơn ${payment.order.code} với ${match.amount} USDT (giao dịch ${match.transactionId})`,
      );
    }
  }
}
