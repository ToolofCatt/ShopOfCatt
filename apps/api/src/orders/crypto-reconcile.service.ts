import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { FulfillmentService } from './fulfillment.service';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { reconcileCryptoTransfers, reconcilePayTransfers } from '../common/reconcile-transfers';

const TICK_MS = 60_000;
const CRYPTO_SLACK_MS = 10 * 60_000;

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
    if (!this.binanceExchange.isConfigured) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Nguồn deposit lỗi không được chặn nguồn Pay độc lập trong cùng tick.
      for (const mode of ['CRYPTO', 'BINANCE_ID'] as const) {
        try { await this.reconcile(mode); }
        catch (error) { this.logger.warn(`Đối soát ${mode} thất bại: ${error instanceof Error ? error.message : String(error)}`); }
      }
    } finally { this.running = false; }
  }

  private async reconcile(mode: 'CRYPTO' | 'BINANCE_ID'): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 3_600_000);
    const [orders, instructions, deposits] = await Promise.all([
      this.prisma.payment.findMany({ where: {
        mode, cryptoTxId: null, status: { in: ['PENDING', 'EXPIRED'] },
        order: { status: { in: ['PENDING', 'EXPIRED'] }, createdAt: { gt: cutoff } },
      }, select: { order: { select: { createdAt: true } } } }),
      this.prisma.paymentInstruction.findMany({ where: { mode, createdAt: { gt: cutoff }, payment: { cryptoTxId: null, status: { not: 'SUCCESS' }, order: { status: { in: ['PENDING', 'EXPIRED'] } } } }, select: { createdAt: true } }),
      this.walletCredit.listAwaiting(mode),
    ]);
    if (orders.length === 0 && instructions.length === 0 && deposits.length === 0) return;
    const oldest = Math.min(...orders.map((p) => p.order.createdAt.getTime()), ...instructions.map((i) => i.createdAt.getTime()), ...deposits.map((d) => d.createdAtMs));
    // I/O phải hoàn tất trước arbitration/transaction giữ tiền và kho.
    const history = mode === 'CRYPTO'
      ? await this.binanceExchange.listUsdtDeposits(oldest - CRYPTO_SLACK_MS)
      : await this.binanceExchange.listPayTransactions(oldest - CRYPTO_SLACK_MS);
    const receiver = mode === 'BINANCE_ID' ? await this.settings.getBinanceId() : '';
    const orderIds = await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      return mode === 'CRYPTO'
        ? reconcileCryptoTransfers(tx, history as Awaited<ReturnType<BinanceExchangeService['listUsdtDeposits']>>)
        : reconcilePayTransfers(tx, history as Awaited<ReturnType<BinanceExchangeService['listPayTransactions']>>, receiver);
    }, FINANCIAL_TRANSACTION);
    for (const id of orderIds) {
      try { await this.fulfillment.deliverOrder(id); }
      catch (error) { this.logger.warn(`Giao sau settlement cần thử lại: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
