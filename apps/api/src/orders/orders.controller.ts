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
import { CreateOrderDto } from './dto/create-order.dto';
import { SelectPaymentDto } from './dto/select-payment.dto';
import { SubmitTxDto } from './dto/submit-tx.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
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

  @Post(':code/check-payment')
  @HttpCode(HttpStatus.OK)
  checkPayment(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<CheckPaymentDto> {
    return this.ordersService.checkPayment(user.id, code);
  }

  @Post(':code/submit-tx')
  @HttpCode(HttpStatus.OK)
  submitTx(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Body() dto: SubmitTxDto,
  ): Promise<CheckPaymentDto> {
    return this.ordersService.submitTx(user.id, code, dto.txId);
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
