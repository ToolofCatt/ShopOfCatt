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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import type {
  AddStockResponse,
  AdminAnnouncementDto,
  AdminCouponDto,
  AdminOrderDetailDto,
  AdminStatsDto,
  AdminStoreSettingDto,
  AuditLogDto,
  LegalPageDto,
  BinanceStatusDto,
  OrderSummaryDto,
  Paginated,
  ProductDto,
  ProductVariantDto,
  RevenuePointDto,
  StockItemDto,
  WithdrawStockResponse,
  StoreInsightsDto,
  TranslationStatusDto,
} from '@webcatt/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { UpdateAnnouncementDto } from '../announcement/dto/update-announcement.dto';
import { AuditQueryDto } from '../audit/dto/audit-query.dto';
import { AuditService } from '../audit/audit.service';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import { CouponsService } from '../coupons/coupons.service';
import { LegalService } from '../legal/legal.service';
import { UpdateLegalPageDto } from '../legal/dto/update-legal-page.dto';
import {
  CreateCouponDto,
  UpdateCouponDto,
} from '../coupons/dto/coupon-admin.dto';
import { SettingsService } from '../settings/settings.service';
import { UpdateSettingsDto } from '../settings/dto/update-settings.dto';
import { AdminService } from './admin.service';
import { AddStockDto } from './dto/add-stock.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';
import { CreateProductDto } from './dto/create-product.dto';
import {
  AddProductImageDto,
  ReorderProductImagesDto,
} from './dto/product-image.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { OrdersQueryDto } from './dto/orders-query.dto';
import { InsightsQueryDto } from './dto/insights-query.dto';
import { StatsSeriesQueryDto } from './dto/stats-series-query.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { WithdrawStockDto } from './dto/withdraw-stock.dto';
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
    private readonly legalService: LegalService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---------- Trang chính sách ----------

  @Get('legal')
  listLegal(): Promise<LegalPageDto[]> {
    return this.legalService.listAdmin();
  }

  @Put('legal/:slug')
  updateLegal(
    @CurrentUser() user: User,
    @Param('slug') slug: string,
    @Body() dto: UpdateLegalPageDto,
  ): Promise<LegalPageDto> {
    return this.legalService.update(user, slug, dto);
  }

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

  /** Khách xem gì, tìm gì — số liệu để quyết định giá và nhập hàng. */
  @Get('stats/insights')
  getInsights(@Query() query: InsightsQueryDto): Promise<StoreInsightsDto> {
    return this.analytics.getInsights(query.days ?? 30);
  }

  // ---------- Nhật ký thao tác ----------

  @Get('audit')
  listAudit(@Query() query: AuditQueryDto): Promise<Paginated<AuditLogDto>> {
    return this.auditService.list(query);
  }

  // ---------- Dịch tự động ----------

  @Get('translation/status')
  getTranslationStatus(): Promise<TranslationStatusDto> {
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

  /**
   * Một sản phẩm, kèm ảnh phụ — endpoint danh sách cố ý không trả ảnh phụ.
   *
   * Trước đây trang sửa sản phẩm gọi `GET products` rồi tự tìm theo id: kéo về
   * toàn bộ sản phẩm chỉ để dùng một cái, và không có chỗ nào đưa ảnh phụ tới.
   */
  @Get('products/:id')
  getProduct(@Param('id') id: string): Promise<ProductDto> {
    return this.adminService.loadProduct(id);
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

  // ---------- Ảnh phụ của sản phẩm ----------

  @Post('products/:id/images')
  addProductImage(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: AddProductImageDto,
  ): Promise<ProductDto> {
    return this.adminService.addProductImage(user, id, dto);
  }

  @Patch('products/:id/images/order')
  reorderProductImages(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ReorderProductImagesDto,
  ): Promise<ProductDto> {
    return this.adminService.reorderProductImages(user, id, dto);
  }

  @Delete('images/:id')
  deleteProductImage(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<ProductDto> {
    return this.adminService.deleteProductImage(user, id);
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

  /**
   * Rút kho: chủ shop tự lấy key ra khỏi kho để thu hồi.
   *
   * `@Post` chứ không `@Delete`: thao tác này TRẢ VỀ nội dung các dòng vừa rút
   * để chủ shop sao chép, mà thân phản hồi của DELETE thì nhiều lớp trung gian
   * cắt bỏ.
   */
  @Post('variants/:id/withdraw')
  withdrawStock(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: WithdrawStockDto,
  ): Promise<WithdrawStockResponse> {
    return this.adminService.withdrawStock(user, id, dto);
  }

  /** Trả một dòng đã rút về lại kho. */
  @Post('stock/:id/restore')
  restoreStockItem(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<StockItemDto> {
    return this.adminService.restoreStock(user, id);
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

  /**
   * Xuất đơn hàng ra CSV theo đúng bộ lọc đang xem — dùng để làm sổ sách.
   * Đặt TRƯỚC route 'orders/:code' vì Nest khớp theo thứ tự khai báo, nếu không
   * 'export' sẽ bị hiểu là một mã đơn.
   */
  @Get('orders/export')
  async exportOrders(
    @Query() query: OrdersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.adminService.exportOrdersCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="don-hang-${stamp}.csv"`,
    );
    return csv;
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

  /**
   * Xác nhận đã nhận tiền ngoài hệ thống (chuyển khoản ngân hàng, USDT không tự
   * khớp được) rồi giao hàng ngay. Ghi nhật ký kèm ghi chú của quản trị viên.
   */
  @Post('orders/:code/mark-paid')
  @HttpCode(HttpStatus.OK)
  markOrderPaid(
    @CurrentUser() user: User,
    @Param('code') code: string,
    @Body() dto: MarkPaidDto,
  ): Promise<AdminOrderDetailDto> {
    return this.adminService.markOrderPaid(user, code, dto.note);
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
