import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { CouponPreviewDto } from '@webcatt/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CouponsService } from './coupons.service';
import { PreviewCouponDto } from './dto/preview-coupon.dto';

@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  /** Kiểm tra mã trước khi đặt hàng — cần đăng nhập vì có giới hạn theo khách. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  preview(
    @CurrentUser() user: User,
    @Body() dto: PreviewCouponDto,
  ): Promise<CouponPreviewDto> {
    return this.coupons.preview(user.id, dto);
  }
}
