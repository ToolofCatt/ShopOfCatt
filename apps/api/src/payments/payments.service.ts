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
  async handleSepayWebhook(tx: SepayTransaction): Promise<string> {
    const ref = String(tx.id);
    if (ref === '' || ref === 'undefined') {
      return 'bo qua: giao dich khong co id';
    }

    // Đã ghi nhận rồi thì thôi — webhook được gửi lại là chuyện bình thường.
    const daCo = await this.prisma.payment.findUnique({
      where: { sepayRef: ref },
      select: { orderId: true },
    });
    if (daCo) {
      return `bo qua: giao dich ${ref} da duoc ghi nhan truoc do`;
    }
    if (await this.balance.findDepositBySepayRef(ref)) {
      return `bo qua: giao dich ${ref} da duoc ghi cho mot ma nap truoc do`;
    }

    const cauHinh = await this.settings.getSepayConfig();

    /*
     * Nhận cả đơn ĐÃ HẾT HẠN, không chỉ PENDING.
     *
     * Chuyển khoản liên ngân hàng có lúc chậm hơn 30 phút hết hạn đơn. Tiền đã
     * vào tài khoản rồi thì phải giao hàng — `markPaidAndDeliver` cũng nhận
     * EXPIRED nên kho được lấy bù nếu dòng cũ đã bị nhả.
     */
    const dangCho = await this.prisma.payment.findMany({
      where: {
        mode: 'SEPAY',
        status: 'PENDING',
        sepayRef: null,
        order: { status: { in: ['PENDING', 'EXPIRED'] } },
      },
      select: {
        id: true,
        orderId: true,
        vndAmount: true,
        order: { select: { code: true } },
      },
    });

    const kq = matchSepayTransaction(
      tx,
      dangCho
        .filter((p) => p.vndAmount !== null)
        .map((p) => ({
          orderId: p.orderId,
          code: p.order.code,
          expectedVnd: Number(p.vndAmount),
        })),
      { expectedAccountNumber: cauHinh.accountNumber },
    );

    if (!kq.payment) {
      /*
       * Không khớp đơn nào — thử MÃ NẠP VÍ (NAP-xxx) bằng CHÍNH bộ matcher
       * này: cùng luật mã-trong-nội-dung + số tiền tuyệt đối, không có nhánh
       * nới lỏng riêng cho nạp tiền.
       */
      const napKq = matchSepayTransaction(
        tx,
        (await this.balance.listAwaitingDeposits()).map((d) => ({
          orderId: d.id, // matcher gọi là orderId nhưng chỉ là id tham chiếu
          code: d.code,
          expectedVnd: d.expectedVnd,
        })),
        { expectedAccountNumber: cauHinh.accountNumber },
      );
      if (napKq.payment) {
        const daCong = await this.balance.creditDeposit(napKq.payment.orderId, ref);
        if (daCong) {
          this.logger.log(
            `SePay ${ref}: da cong vi (ma nap) — ${tx.transferAmount} VND`,
          );
          return 'da cong vi (ma nap)';
        }
        return `bo qua: ma nap vua duoc mot tien trinh khac ghi nhan`;
      }
      const themVao =
        kq.reason === 'sai-so-tien' ? ` (lech ${kq.shortfall} VND)` : '';
      this.logger.warn(
        `SePay ${ref}: khong khop — ${kq.reason}${themVao}. ` +
          `So tien ${tx.transferAmount} VND, noi dung "${tx.content}"`,
      );
      return `khong khop: ${kq.reason}`;
    }

    const payment = dangCho.find((p) => p.orderId === kq.payment?.orderId);
    if (!payment) return 'khong khop: khong tim lai duoc don';

    /*
     * Ghi `sepayRef` TRƯỚC khi giao hàng. Ràng buộc @unique là trọng tài: hai
     * webhook cùng lúc thì chỉ một bên ghi được, bên kia nhận P2002 và dừng —
     * không giao hàng hai lần.
     */
    try {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { sepayRef: ref, status: 'SUCCESS' },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return `bo qua: giao dich ${ref} vua duoc mot tien trinh khac ghi nhan`;
      }
      throw error;
    }

    await this.fulfillment.markPaidAndDeliver({ orderId: payment.orderId });
    this.logger.log(
      `SePay ${ref}: da khop don ${payment.order.code} — ${tx.transferAmount} VND`,
    );
    return `da khop don ${payment.order.code}`;
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

    const payment = await this.prisma.payment.findUnique({
      where: { merchantTradeNo },
      select: { id: true, orderId: true },
    });
    if (!payment) {
      this.logger.warn(
        `Webhook Binance: không tìm thấy payment cho merchantTradeNo=${merchantTradeNo}`,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { rawWebhook: payload as unknown as Prisma.InputJsonValue },
    });

    if (payload.bizStatus === 'PAY_SUCCESS') {
      await this.fulfillment.markPaidAndDeliver({ merchantTradeNo });
    } else if (payload.bizStatus === 'PAY_CLOSED') {
      await this.fulfillment.expireOrder(payment.orderId);
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
    if (!this.isMockMode) {
      throw new ForbiddenException(
        K.paymentMockDisabled,
      );
    }
    const order = await this.prisma.order.findFirst({
      where: { code, userId },
      select: { id: true, payment: { select: { mode: true } } },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    // Đơn đang chờ Binance Pay hoặc chuyển USDT thật thì không được "giả lập" xong.
    if (order.payment?.mode !== 'MOCK') {
      throw new ForbiddenException(K.paymentMockDisabled);
    }
    const result = await this.fulfillment.markPaidAndDeliver({
      orderId: order.id,
    });
    if (!result) {
      throw new NotFoundException(K.orderNotFound);
    }
    return { status: result.status };
  }
}
