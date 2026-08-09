import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type {
  AddStockResponse,
  AdminAnnouncementDto,
  AdminCouponDto,
  AdminOrderDetailDto,
  AdminStatsDto,
  AdminStoreSettingDto,
  AuditLogDto,
  BinanceStatusDto,
  OrderSummaryDto,
  Paginated,
  ProductDto,
  ProductVariantDto,
  RevenuePointDto,
  StockItemDto,
  TranslationStatusDto,
} from '@webcatt/shared';
import { AnnouncementService } from '../announcement/announcement.service';
import { UpdateAnnouncementDto } from '../announcement/dto/update-announcement.dto';
import { AuditQueryDto } from '../audit/dto/audit-query.dto';
import { AuditService } from '../audit/audit.service';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import { CouponsService } from '../coupons/coupons.service';
import {
  CreateCouponDto,
  UpdateCouponDto,
} from '../coupons/dto/coupon-admin.dto';
import { SettingsService } from '../settings/settings.service';
import { UpdateSettingsDto } from '../settings/dto/update-settings.dto';
import { AdminService } from './admin.service';
import { AddStockDto } from './dto/add-stock.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { OrdersQueryDto } from './dto/orders-query.dto';
import { StatsSeriesQueryDto } from './dto/stats-series-query.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly announcementService: AnnouncementService,
    private readonly auditService: AuditService,
    private readonly settingsService: SettingsService,
    private readonly binanceExchange: BinanceExchangeService,
    private readonly couponsService: CouponsService,
  ) {}

  // ---------- Mã giảm giá ----------

  @Get('coupons')
  listCoupons(): Promise<AdminCouponDto[]> {
    return this.couponsService.list();
  }

  @Post('coupons')
  createCoupon(
    @CurrentUser() user: User,
    @Body() dto: CreateCouponDto,
  ): Promise<AdminCouponDto> {
    return this.couponsService.create(user, dto);
  }

  @Patch('coupons/:id')
  updateCoupon(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<AdminCouponDto> {
    return this.couponsService.update(user, id, dto);
  }

  @Delete('coupons/:id')
  deleteCoupon(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.couponsService.remove(user, id);
  }

  // ---------- Cấu hình cửa hàng & thanh toán ----------

  @Get('settings')
  getSettings(): Promise<AdminStoreSettingDto> {
    return this.settingsService.getAdmin();
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() user: User,
    @Body() dto: UpdateSettingsDto,
  ): Promise<AdminStoreSettingDto> {
    return this.settingsService.update(user, dto);
  }

  @Get('binance/status')
  getBinanceStatus(): Promise<BinanceStatusDto> {
    return this.binanceExchange.getStatus();
  }

  // ---------- Thống kê ----------

  @Get('stats')
  getStats(): Promise<AdminStatsDto> {
    return this.adminService.getStats();
  }

  @Get('stats/series')
  getStatsSeries(
    @Query() query: StatsSeriesQueryDto,
  ): Promise<RevenuePointDto[]> {
    return this.adminService.getStatsSeries(query.days ?? 7);
  }

  // ---------- Nhật ký thao tác ----------

  @Get('audit')
  listAudit(@Query() query: AuditQueryDto): Promise<Paginated<AuditLogDto>> {
    return this.auditService.list(query);
  }

  // ---------- Dịch tự động ----------

  @Get('translation/status')
  getTranslationStatus(): TranslationStatusDto {
    return this.adminService.getTranslationStatus();
  }

  // ---------- Thông báo trang chủ ----------

  @Get('announcement')
  getAnnouncement(): Promise<AdminAnnouncementDto> {
    return this.announcementService.getAdmin();
  }

  @Put('announcement')
  updateAnnouncement(
    @CurrentUser() user: User,
    @Body() dto: UpdateAnnouncementDto,
  ): Promise<AdminAnnouncementDto> {
    return this.announcementService.update(user, dto);
  }

  @Post('announcement/translate')
  @HttpCode(HttpStatus.OK)
  translateAnnouncement(
    @CurrentUser() user: User,
  ): Promise<AdminAnnouncementDto> {
    return this.announcementService.translate(user);
  }

  // ---------- Sản phẩm ----------

  @Get('products')
  listProducts(): Promise<ProductDto[]> {
    return this.adminService.listProducts();
  }

  @Post('products')
  createProduct(
    @CurrentUser() user: User,
    @Body() dto: CreateProductDto,
  ): Promise<ProductDto> {
    return this.adminService.createProduct(user, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    return this.adminService.updateProduct(user, id, dto);
  }

  @Delete('products/:id')
  deleteProduct(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.adminService.deleteProduct(user, id);
  }

  @Post('products/:id/translate')
  @HttpCode(HttpStatus.OK)
  translateProduct(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<ProductDto> {
    return this.adminService.translateProduct(user, id);
  }

  // ---------- Loại sản phẩm ----------

  @Post('products/:id/variants')
  createVariant(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
  ): Promise<ProductVariantDto> {
    return this.adminService.createVariant(user, id, dto);
  }

  @Patch('variants/:id')
  updateVariant(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    return this.adminService.updateVariant(user, id, dto);
  }

  @Delete('variants/:id')
  deleteVariant(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.adminService.deleteVariant(user, id);
  }

  // ---------- Kho hàng (theo loại) ----------

  @Post('variants/:id/stock')
  addStock(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: AddStockDto,
  ): Promise<AddStockResponse> {
    return this.adminService.addStock(user, id, dto);
  }

  @Get('variants/:id/stock')
  listStock(
    @Param('id') id: string,
    @Query() query: StockQueryDto,
  ): Promise<Paginated<StockItemDto>> {
    return this.adminService.listStock(id, query);
  }

  @Delete('stock/:id')
  deleteStockItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.adminService.deleteStockItem(user, id);
  }

  // ---------- Đơn hàng ----------

  @Get('orders')
  listOrders(
    @Query() query: OrdersQueryDto,
  ): Promise<Paginated<OrderSummaryDto>> {
    return this.adminService.listOrders(query);
  }

  @Get('orders/:code')
  getOrderDetail(@Param('code') code: string): Promise<AdminOrderDetailDto> {
    return this.adminService.getOrderDetail(code);
  }

  @Post('orders/:code/deliver')
  @HttpCode(HttpStatus.OK)
  redeliverOrder(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<AdminOrderDetailDto> {
    return this.adminService.redeliverOrder(user, code);
  }

  @Post('orders/:code/cancel')
  @HttpCode(HttpStatus.OK)
  cancelOrder(
    @CurrentUser() user: User,
    @Param('code') code: string,
  ): Promise<AdminOrderDetailDto> {
    return this.adminService.cancelOrder(user, code);
  }
}
