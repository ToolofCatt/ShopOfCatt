import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type {
  CheckPaymentDto,
  CreateOrderResponse,
  OrderDetailDto,
  OrderStatus,
  OrderSummaryDto,
} from '@webcatt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { SelectPaymentDto } from './dto/select-payment.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';
import { OrdersService } from './orders.service';

const MINUTES_10 = 10 * 60_000;

// JwtAuthGuard chạy trước RateLimitGuard nên bộ đếm khoá được theo tài khoản.
@Controller('orders')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Mỗi lần tạo đơn mở một transaction và khoá dòng kho — không để gọi dồn.
  @Post()
  @RateLimit({ limit: 30, windowMs: MINUTES_10 })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateOrderDto,
  ): Promise<CreateOrderResponse> {
    return this.ordersService.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User): Promise<OrderSummaryDto[]> {
    return this.ordersService.listOwn(user.id);
  }

  @Get(':code')
  detail(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<OrderDetailDto> {
    return this.ordersService.getOwnDetail(user.id, code);
  }

  @Post(':code/select-payment')
  @HttpCode(HttpStatus.OK)
  selectPayment(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Body() dto: SelectPaymentDto,
  ): Promise<OrderDetailDto> {
    return this.ordersService.selectPayment(user.id, code, dto.method);
  }

  // Trang thanh toán tự hỏi mỗi 4 giây; mỗi lần có thể gọi ra API Binance.
  // 60 lần/5 phút vẫn thoải mái cho một tab, nhưng chặn được việc mở hàng loạt.
  @Post(':code/check-payment')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 60, windowMs: 5 * 60_000 })
  checkPayment(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<CheckPaymentDto> {
    return this.ordersService.checkPayment(user.id, code);
  }

  // Mỗi lần nhập TxID đều gọi sang Binance — đây là hạn mức API của chính mình.
  @Post(':code/submit-tx')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: MINUTES_10 })
  submitTx(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Body() dto: SubmitTxDto,
  ): Promise<CheckPaymentDto> {
    return this.ordersService.submitTx(user.id, code, dto.txId);
  }

  // Khách báo "tôi đã chuyển khoản" — chỉ đánh dấu để admin biết đơn nào cần
  // đối soát sao kê; KHÔNG tự chuyển trạng thái đơn.
  @Post(':code/claim-transfer')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: MINUTES_10 })
  claimTransfer(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<OrderDetailDto> {
    return this.ordersService.claimBankTransfer(user.id, code);
  }

  @Post(':code/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<{ status: OrderStatus }> {
    return this.ordersService.cancel(user.id, code);
  }
}
