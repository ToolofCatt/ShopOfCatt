import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { OrderStatus } from '@webcatt/shared';
import { FulfillmentService } from '../orders/fulfillment.service';
import { BalanceService } from '../balance/balance.service';
import { SettingsService } from '../settings/settings.service';
import {
  matchSepayTransaction,
  type SepayTransaction,
} from './sepay-matcher';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';
import { FINANCIAL_TRANSACTION, lockFinancialArbitration } from '../common/financial-lock';
import { creditDepositTransfer, observeTransfer, reviewTransfer, settleOrderTransfer } from '../common/incoming-transfer';
import { markOrderPaid } from '../common/order-settlement';

export interface BinanceWebhookPayload {
  bizType?: string;
  bizStatus?: string;
  bizId?: number | string;
  bizIdStr?: string;
  data?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fulfillment: FulfillmentService,
    private readonly settings: SettingsService,
    private readonly balance: BalanceService,
  ) {}


  /**
   * Xử lý một giao dịch SePay đã qua xác thực.
   *
   * Trả về mô tả ngắn để controller ghi log. KHÔNG ném lỗi khi không khớp: SePay
   * sẽ gửi lại webhook nếu không nhận được 200, và một giao dịch không liên quan
   * (khách chuyển thiếu, người khác chuyển vào tài khoản) thì gửi lại bao nhiêu
   * lần cũng vẫn không khớp — chỉ tạo ra một vòng thử lại vô nghĩa.
   */
  async handleSepayWebhook(event: SepayTransaction): Promise<string> {
    const ref = String(event.id ?? '').trim();
    if (!ref || event.transferType !== 'in' || !Number.isFinite(event.transferAmount) || event.transferAmount <= 0) return 'bo qua: giao dich khong hop le';
    const config = await this.settings.getSepayConfig();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      const transfer = await observeTransfer(tx, { source: 'SEPAY', reference: ref, amount: event.transferAmount, currency: 'VND', receiver: event.accountNumber });
      if (transfer.status === 'CLAIMED') return {
        orderId: transfer.paymentId ? await settleOrderTransfer(tx, transfer.paymentId, transfer) : null,
        text: 'bo qua: giao dich da ghi nhan',
      };
      if (transfer.status === 'REVIEW') return { orderId: null, text: 'can doi soat' };
      const [payments, instructions, deposits] = await Promise.all([
        tx.payment.findMany({ where: { mode: 'SEPAY', status: { in: ['PENDING', 'EXPIRED', 'FAILED'] }, sepayRef: null, order: { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } } }, include: { order: { select: { code: true } } } }),
        tx.paymentInstruction.findMany({ where: { mode: 'SEPAY', payment: { status: { not: 'SUCCESS' }, sepayRef: null, order: { status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] } } } }, include: { payment: { include: { order: { select: { code: true } } } } } }),
        tx.deposit.findMany({ where: { mode: 'SEPAY', status: { in: ['PENDING', 'EXPIRED', 'CANCELLED'] }, sepayRef: null } }),
      ]);
      const all = [
        ...payments.filter((p) => p.vndAmount !== null).map((p) => ({ orderId: `payment:${p.id}`, code: p.order.code, expectedVnd: Number(p.vndAmount), account: p.cryptoAddress })),
        ...instructions.map((i) => ({ orderId: `payment:${i.paymentId}`, code: i.payment.order.code, expectedVnd: Number(i.amount), account: i.receiver })),
        ...deposits.map((d) => ({ orderId: `deposit:${d.id}`, code: d.code, expectedVnd: Number(d.vndAmount), account: d.cryptoAddress })),
      ];
      // Một đích có nhiều QR đã phát hành. Chọn theo snapshot account+amount rồi dedupe target.
      const pool = [...new Map(all.filter((p) => p.account && p.account === event.accountNumber?.trim() && p.expectedVnd === event.transferAmount).map((p) => [p.orderId, p])).values()];
      const match = matchSepayTransaction(event, pool);
      if (!match.payment) {
        const unresolved = matchSepayTransaction(event, all);
        if (unresolved.payment || match.reason !== 'khong-thay-ma-don') await reviewTransfer(tx, transfer, unresolved.payment ? 'missing-or-mismatched-receiver-snapshot' : match.reason ?? 'unmatched');
        return { orderId: null, text: `khong khop: ${match.reason}` };
      }
      const selected = pool.find((p) => p.orderId === match.payment!.orderId)!;
      if (!selected.account || selected.account !== event.accountNumber?.trim()) {
        await reviewTransfer(tx, transfer, 'wrong-receiver'); return { orderId: null, text: 'khong khop: sai-tai-khoan' };
      }
      if (selected.orderId.startsWith('deposit:')) {
        const credited = await creditDepositTransfer(tx, selected.orderId.slice(8), transfer);
        return { orderId: null, text: credited ? 'da cong vi (ma nap)' : 'can doi soat' };
      }
      const orderId = await settleOrderTransfer(tx, selected.orderId.slice(8), transfer);
      return { orderId, text: orderId ? `da khop don ${selected.code}` : 'can doi soat' };
    }, FINANCIAL_TRANSACTION);
    if (result.orderId) await this.fulfillment.deliverOrder(result.orderId);
    return result.text;
  }

  /**
   * Chế độ giả lập phải FAIL-CLOSED: chỉ bật khi biến môi trường ghi đúng "true".
   * Thiếu biến, ghi sai chính tả, để trống → coi như TẮT. Bật nhầm ở môi trường
   * thật đồng nghĩa với phát hàng miễn phí.
   */
  get isMockMode(): boolean {
    return (this.config.get<string>('PAYMENT_MOCK') ?? '').trim() === 'true';
  }

  /**
   * Xử lý webhook Binance (chữ ký đã được xác minh ở controller):
   * PAY_SUCCESS → đánh dấu đã thanh toán + giao hàng;
   * PAY_CLOSED → hết hạn đơn + nhả kho. Payload thô lưu vào Payment.rawWebhook.
   */
  async handleBinanceWebhook(payload: BinanceWebhookPayload): Promise<void> {
    let merchantTradeNo: string | undefined;
    if (typeof payload.data === 'string' && payload.data.length > 0) {
      try {
        const data = JSON.parse(payload.data) as {
          merchantTradeNo?: string;
        };
        merchantTradeNo = data.merchantTradeNo;
      } catch {
        this.logger.warn('Webhook Binance: trường data không phải JSON hợp lệ');
      }
    }
    if (!merchantTradeNo) {
      this.logger.warn('Webhook Binance: thiếu merchantTradeNo — bỏ qua');
      return;
    }

    const reference = merchantTradeNo;
    const session = await this.prisma.merchantPaymentSession.findUnique({ where: { merchantTradeNo: reference }, include: { payment: true } });
    const payment = session?.payment ?? await this.prisma.payment.findUnique({ where: { merchantTradeNo: reference } });
    if (!payment) { this.logger.warn('Webhook Binance: không tìm thấy phiên thanh toán'); return; }
    if (payload.bizStatus === 'PAY_SUCCESS') {
      const orderId = await this.prisma.$transaction(async (tx) => {
        await lockFinancialArbitration(tx);
        const transfer = await observeTransfer(tx, { source: 'BINANCE_MERCHANT', reference, amount: session?.orderTotalAmount ?? payment.amount, currency: 'USDT' });
        const id = await settleOrderTransfer(tx, payment.id, transfer);
        await tx.payment.update({ where: { id: payment.id }, data: { rawWebhook: payload as unknown as Prisma.InputJsonValue } });
        return id;
      }, FINANCIAL_TRANSACTION);
      if (orderId) await this.fulfillment.deliverOrder(orderId);
    } else if (payload.bizStatus === 'PAY_CLOSED' && payment.merchantTradeNo === reference && payment.mode === 'BINANCE') {
      await this.fulfillment.expireOrder(payment.orderId, { merchantTradeNo: reference, sessionVersion: payment.sessionVersion });
    }
  }

  /**
   * Cổng giả lập xác nhận đã thanh toán — chỉ hoạt động khi PAYMENT_MOCK=true,
   * chỉ với đơn CỦA CHÍNH khách đó, và chỉ khi đơn đang thật sự ở chế độ MOCK.
   * Thiếu bất kỳ điều kiện nào cũng là một đường lấy hàng miễn phí.
   */
  async confirmMock(
    userId: string,
    code: string,
  ): Promise<{ status: OrderStatus }> {
    if (!this.isMockMode) throw new ForbiddenException(K.paymentMockDisabled);
    const orderId = await this.prisma.$transaction(async (tx) => {
      await lockFinancialArbitration(tx);
      // Giữ gate DB tới commit: tắt công tắc không được đua với confirm miễn phí.
      await tx.$queryRaw`SELECT id FROM "StoreSetting" WHERE id = 'main' FOR SHARE`;
      const setting = await tx.storeSetting.findUnique({ where: { id: 'main' }, select: { mockEnabled: true } });
      if (!setting?.mockEnabled) throw new ForbiddenException(K.paymentMockDisabled);
      const order = await tx.order.findFirst({ where: { code, userId }, include: { payment: true } });
      if (!order) throw new NotFoundException(K.orderNotFound);
      if (order.payment?.mode !== 'MOCK') throw new ForbiddenException(K.paymentMockDisabled);
      await markOrderPaid(tx, order.id);
      return order.id;
    }, FINANCIAL_TRANSACTION);
    const live = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    if (live.status === 'PAID') await this.fulfillment.deliverOrder(orderId);
    return { status: (await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status };
  }
}
