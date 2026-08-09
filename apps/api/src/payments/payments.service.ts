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
  ) {}

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
