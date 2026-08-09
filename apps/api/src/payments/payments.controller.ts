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
