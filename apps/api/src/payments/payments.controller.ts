import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { OrderStatus } from '@webcatt/shared';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BinanceService } from './binance.service';
import { MockConfirmDto } from './dto/mock-confirm.dto';
import {
  PaymentsService,
  type BinanceWebhookPayload,
} from './payments.service';
import { K } from '../i18n/messages';

function headerValue(request: Request, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/**
 * Webhook chỉ được nhận trong khoảng này quanh thời điểm Binance ký.
 *
 * Chữ ký RSA của Binance không bao giờ hết hạn, nên một webhook hợp lệ bị ghi lại
 * (log của proxy, người trong mạng) có thể phát lại mãi mãi. Hiện tại hai nhánh
 * xử lý đều có guard trạng thái nên phát lại không cộng tiền hai lần — cửa sổ này
 * để nó VẪN vô hại kể cả khi ai đó sửa hai nhánh kia sau này.
 *
 * 5 phút là đủ rộng cho lệch giờ giữa các máy chủ và một lần Binance thử lại.
 */
const WEBHOOK_MAX_AGE_MS = 5 * 60_000;

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly binanceService: BinanceService,
  ) {}

  @Post('binance/webhook')
  @HttpCode(HttpStatus.OK)
  async binanceWebhook(
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ returnCode: string; returnMessage: null }> {
    if (this.paymentsService.isMockMode) {
      throw new ForbiddenException(
        K.paymentWebhookDisabled,
      );
    }

    const timestamp = headerValue(request, 'binancepay-timestamp');
    const nonce = headerValue(request, 'binancepay-nonce');
    const signature = headerValue(request, 'binancepay-signature');
    const rawBody = request.rawBody ? request.rawBody.toString('utf8') : '';

    // Kiểm hạn TRƯỚC khi xác minh chữ ký: rẻ hơn, và tránh phải tải chứng chỉ
    // cho một loạt webhook phát lại.
    const signedAtMs = Number.parseInt(timestamp, 10);
    if (
      !Number.isFinite(signedAtMs) ||
      Math.abs(Date.now() - signedAtMs) > WEBHOOK_MAX_AGE_MS
    ) {
      throw new HttpException(
        { returnCode: 'FAIL', returnMessage: 'Stale or invalid timestamp' },
        HttpStatus.BAD_REQUEST,
      );
    }

    let valid = false;
    if (timestamp && nonce && signature && rawBody) {
      try {
        valid = await this.binanceService.verifyWebhookSignature(
          timestamp,
          nonce,
          rawBody,
          signature,
        );
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      throw new HttpException(
        // Body này do Binance đọc (máy với máy) — giữ nguyên tiếng Anh, không dịch
        { returnCode: 'FAIL', returnMessage: 'Invalid signature' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const payload = request.body as BinanceWebhookPayload;
    await this.paymentsService.handleBinanceWebhook(payload);
    return { returnCode: 'SUCCESS', returnMessage: null };
  }

  /**
   * Cổng thanh toán GIẢ LẬP — chỉ dùng khi dev/demo.
   * Phải đăng nhập và chỉ xác nhận được ĐƠN CỦA CHÍNH MÌNH: nếu không, bất kỳ ai
   * biết mã đơn cũng nhận được hàng miễn phí.
   */
  @Post('mock/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  mockConfirm(
    @CurrentUser() user: User,
    @Body() dto: MockConfirmDto,
  ): Promise<{ status: OrderStatus }> {
    return this.paymentsService.confirmMock(user.id, dto.code);
  }
}
