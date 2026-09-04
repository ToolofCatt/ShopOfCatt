import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import {
  DISPLAY_CURRENCIES,
  LOW_STOCK_THRESHOLD,
  PRODUCT_IMAGE_MAX_COUNT,
  USDT_DECIMALS,
  floorUsdt,
  toUsdtFromCurrency,
  type AddStockResponse,
  type AdminOrderDetailDto,
  type AdminStatsDto,
  type OrderSummaryDto,
  type Paginated,
  type DisplayCurrency,
  type ProductDto,
  type ProductVariantDto,
  type RevenuePointDto,
  type StockItemDto,
  type WithdrawStockResponse,
  type TranslationStatusDto,
} from '@webcatt/shared';
import { diffChanges } from '../audit/audit-diff';
import { AuditService } from '../audit/audit.service';
import { slugify } from '../common/slugify';
import { FulfillmentService } from '../orders/fulfillment.service';
import { toOrderDetailDto, toOrderSummaryDto } from '../orders/order.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  PRODUCT_IMAGE_META_SELECT,
  PRODUCT_SCALARS,
  VARIANT_ORDER_BY,
  collectVariantIds,
  getVariantStockCountMap,
  toProductDto,
  toProductVariantDto,
} from '../products/product.mapper';
import { TranslationService } from '../translation/translation.service';
import { buildOrdersCsv } from './orders-csv';
import { AddStockDto } from './dto/add-stock.dto';
import {
  AddProductImageDto,
  ReorderProductImagesDto,
} from './dto/product-image.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { OrdersQueryDto } from './dto/orders-query.dto';
import { StockQueryDto } from './dto/stock-query.dto';
import { WithdrawStockDto } from './dto/withdraw-stock.dto';
import type { SeriesDays } from './dto/stats-series-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { K, withParams } from '../i18n/messages';

const DEFAULT_ORDERS_PAGE_SIZE = 20;
/** Trần số dòng khi xuất CSV — một cú bấm không được kéo sập tiến trình. */
const EXPORT_MAX_ROWS = 20000;
const DEFAULT_STOCK_PAGE_SIZE = 50;

/** Tên loại được tạo tự động cùng sản phẩm mới. */
const DEFAULT_VARIANT_NAME = 'Mặc định';

/** Các trường có bản dịch — đổi một trong số này thì dịch lại ở nền. */
const TRANSLATABLE_FIELDS = [
  'name',
  'shortDescription',
  'description',
  'category',
] as const;

/**
 * DANH SÁCH quản trị: mọi loại + mọi bản dịch, cố ý KHÔNG kèm ảnh phụ.
 *
 * `select` chứ không `include`, và đi qua `PRODUCT_SCALARS` để chắc chắn không
 * chạm vào hai cột base64 `image`/`thumbnail`. Danh sách có thể hàng chục sản
 * phẩm, mỗi sản phẩm tới 6 tấm ảnh — kéo hết về đây là mỗi lần mở trang Sản
 * phẩm tốn vài chục MB, trong khi giao diện chỉ cần một ô ảnh nhỏ.
 */
const ADMIN_PRODUCT_SELECT = {
  ...PRODUCT_SCALARS,
  variants: { orderBy: VARIANT_ORDER_BY, include: { translations: true } },
  translations: true,
} satisfies Prisma.ProductSelect;

/** MỘT sản phẩm (trang sửa): thêm phần mô tả ảnh phụ theo đúng thứ tự. */
const ADMIN_PRODUCT_DETAIL_SELECT = {
  ...ADMIN_PRODUCT_SELECT,
  images: { select: PRODUCT_IMAGE_META_SELECT, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.ProductSelect;

/**
 * Chuẩn hóa chuỗi nullable: trim, chuỗi rỗng → null.
 *
 * PHẢI nhận cả `null`. Biểu mẫu sửa sản phẩm gửi `null` cho mọi ô văn bản để
 * trống (đó là cách xoá một giá trị đã đặt), mà `@IsOptional()` của
 * class-validator bỏ qua null y như undefined nên nó đi thẳng xuống đây. Bản
 * trước chỉ chặn `undefined` rồi gọi `.trim()`, nên chỉ cần sửa một sản phẩm mà
 * để trống "Mô tả ngắn" là API đổ 500 "Cannot read properties of null".
 */
function normalizeNullable(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Cỡ ảnh sau giải mã, tính từ data URI. `null` khi không có ảnh.
 *
 * Cột `bytes`/`imageBytes` tồn tại để mọi truy vấn khác biết "có ảnh không" và
 * "nặng bao nhiêu" mà không phải đọc cột base64 — nên nó phải được tính đúng
 * ngay tại chỗ ghi.
 */
function dataUriBytes(value: string | null | undefined): number | null {
  if (!value) return null;
  const comma = value.indexOf(',');
  const payload = comma === -1 ? value : value.slice(comma + 1);
  return Buffer.byteLength(payload, 'base64');
}

type ProductScalars = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SCALARS }>;

/**
 * Ảnh chụp phẳng các trường vô hướng của sản phẩm — để diff cho nhật ký.
 *
 * Ảnh ghi bằng SỐ BYTE, không ghi nội dung: data URI dài tới ~375 KB mà
 * `diffChanges` lưu cả giá trị cũ lẫn mới, nên đổi ảnh một lần là một dòng nhật
 * ký gần 1 MB — nằm trong cả 14 bản sao lưu. Số byte vẫn đủ để biết ảnh có đổi.
 */
function productSnapshot(product: ProductScalars): Record<string, unknown> {
  return {
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    imageBytes: product.imageBytes,
    thumbnailBytes: product.thumbnailBytes,
    category: product.category,
    sortOrder: product.sortOrder,
    active: product.active,
  };
}

/** Ngày theo múi giờ máy chủ, dạng YYYY-MM-DD. */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
    private readonly translation: TranslationService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ---------- Thống kê ----------

  async getStats(): Promise<AdminStatsDto> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      revenueAgg,
      ordersTotal,
      ordersPending,
      ordersToday,
      productsActive,
      customersTotal,
      customersNew30d,
      activeVariants,
      topProducts,
      readiness,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: { status: { in: ['PAID', 'DELIVERED'] } },
      }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.product.count({ where: { active: true } }),
      this.prisma.user.count({ where: { role: 'USER' } }),
      this.prisma.user.count({
        where: { role: 'USER', createdAt: { gte: last30Days } },
      }),
      this.prisma.productVariant.findMany({
        where: { active: true, product: { active: true } },
        select: {
          id: true,
          name: true,
          productId: true,
          product: { select: { name: true } },
        },
      }),
      this.getTopProducts(last30Days),
      this.settings.getReadiness(),
    ]);

    const counts = await getVariantStockCountMap(
      this.prisma,
      activeVariants.map((variant) => variant.id),
    );
    const lowStock = activeVariants
      .map((variant) => ({
        productId: variant.productId,
        variantId: variant.id,
        name: variant.product.name,
        variantName: variant.name,
        availableStock: counts.get(variant.id)?.available ?? 0,
      }))
      // Trang danh sách đã gắn nhãn "Sắp hết" ở đúng ngưỡng. Dashboard phải
      // dùng cùng biên <=, nếu không variant còn đúng 5 món biến mất khỏi hộp
      // "Cần xử lý" dù ngay trang sản phẩm vẫn báo sắp hết.
      .filter((entry) => entry.availableStock <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.availableStock - b.availableStock);

    return {
      revenue: Number(revenueAgg._sum.totalAmount ?? 0),
      ordersTotal,
      ordersPending,
      ordersToday,
      productsActive,
      customersTotal,
      customersNew30d,
      topProducts,
      lowStock,
      readiness,
    };
  }

  /**
   * Top 5 sản phẩm theo doanh thu (Σ unitPrice×quantity) của đơn
   * PAID/DELIVERED có paidAt trong khoảng — một truy vấn gộp duy nhất.
   */
  private async getTopProducts(
    since: Date,
  ): Promise<AdminStatsDto['topProducts']> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        productId: string;
        productName: string;
        sold: number;
        revenue: Prisma.Decimal;
      }>
    >`
      SELECT oi."productId" AS "productId",
             MAX(oi."productName") AS "productName",
             SUM(oi."quantity")::int AS "sold",
             SUM(oi."unitPrice" * oi."quantity") AS "revenue"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      WHERE o."status" IN ('PAID'::"OrderStatus", 'DELIVERED'::"OrderStatus")
        AND o."paidAt" >= ${since}
      GROUP BY oi."productId"
      ORDER BY "revenue" DESC
      LIMIT 5
    `;
    if (rows.length === 0) return [];

    // Tên hiện tại của sản phẩm; sản phẩm đã xóa → dùng ảnh chụp productName
    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    return rows.map((row) => ({
      productId: row.productId,
      name: nameById.get(row.productId) ?? row.productName,
      sold: Number(row.sold),
      revenue: Number(row.revenue),
    }));
  }

  /**
   * Doanh thu theo từng ngày (múi giờ máy chủ) — một điểm mỗi ngày,
   * ngày trống điền 0. Tính theo `paidAt` của đơn PAID/DELIVERED.
   */
  async getStatsSeries(days: SeriesDays): Promise<RevenuePointDto[]> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const orders = await this.prisma.order.findMany({
      where: { status: { in: ['PAID', 'DELIVERED'] }, paidAt: { gte: start } },
      select: { paidAt: true, totalAmount: true },
    });

    const buckets = new Map<string, { revenue: number; orders: number }>();
    for (let i = 0; i < days; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      buckets.set(toDateKey(day), { revenue: 0, orders: 0 });
    }
    for (const order of orders) {
      if (!order.paidAt) continue;
      const bucket = buckets.get(toDateKey(order.paidAt));
      if (!bucket) continue;
      bucket.revenue += Number(order.totalAmount);
      bucket.orders += 1;
    }

    return Array.from(buckets.entries()).map(([date, point]) => ({
      date,
      revenue: Math.round(point.revenue * 100) / 100,
      orders: point.orders,
    }));
  }

  // ---------- Sản phẩm ----------

  async listProducts(): Promise<ProductDto[]> {
    const products = await this.prisma.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: ADMIN_PRODUCT_SELECT,
    });
    const counts = await getVariantStockCountMap(
      this.prisma,
      collectVariantIds(products),
    );
    return products.map((product) =>
      toProductDto(product, counts, { includeTranslations: true }),
    );
  }

  /** Tạo sản phẩm kèm loại mặc định giữ mức giá được nhập. */
  async createProduct(actor: User, dto: CreateProductDto): Promise<ProductDto> {
    const name = dto.name.trim();
    const slug = dto.slug?.trim() ? slugify(dto.slug) : slugify(name);
    if (!slug) {
      throw new BadRequestException(K.adminSlugFailed);
    }
    const existing = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(K.adminSlugExists);
    }

    // Chốt giá TRƯỚC khi tạo: neo theo ₫ mà chưa có tỉ giá thì phải báo lỗi rõ
    // ràng, chứ không tạo ra một sản phẩm giá 0 — ai cũng lấy hàng miễn phí.
    const gia = await this.chotGia(dto.price, dto.priceCurrency);

    const product = await this.prisma.product.create({
      data: {
        slug,
        name,
        shortDescription: normalizeNullable(dto.shortDescription) ?? null,
        description: normalizeNullable(dto.description) ?? null,
        image: normalizeNullable(dto.image) ?? null,
        thumbnail: normalizeNullable(dto.thumbnail) ?? null,
        imageBytes: dataUriBytes(normalizeNullable(dto.image)),
        thumbnailBytes: dataUriBytes(normalizeNullable(dto.thumbnail)),
        category: normalizeNullable(dto.category) ?? null,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        stockDrawMode: dto.stockDrawMode ?? 'SEQUENTIAL',
        variants: {
          create: {
            name: DEFAULT_VARIANT_NAME,
            ...gia,
            sortOrder: 0,
            active: true,
          },
        },
      },
      select: { id: true },
    });

    void this.translation.translateProductSafe(product.id);
    await this.audit.log(
      actor,
      'product.create',
      { type: 'product', id: product.id },
      { name },
    );
    return this.loadProduct(product.id);
  }

  async updateProduct(
    actor: User,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: PRODUCT_SCALARS,
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim() ? slugify(dto.slug) : product.slug;
      if (slug !== product.slug) {
        const duplicate = await this.prisma.product.findUnique({
          where: { slug },
          select: { id: true },
        });
        if (duplicate && duplicate.id !== id) {
          throw new ConflictException(K.adminSlugExists);
        }
        data.slug = slug;
      }
    }
    if (dto.shortDescription !== undefined) {
      data.shortDescription = normalizeNullable(dto.shortDescription);
    }
    if (dto.description !== undefined) {
      data.description = normalizeNullable(dto.description);
    }
    // Ảnh và số byte của nó luôn đi cùng nhau — lệch một nhịp là danh sách
    // dựng địa chỉ ảnh cho một sản phẩm không có ảnh (hoặc ngược lại).
    if (dto.image !== undefined) {
      const value = normalizeNullable(dto.image);
      data.image = value;
      data.imageBytes = dataUriBytes(value);
    }
    if (dto.thumbnail !== undefined) {
      const value = normalizeNullable(dto.thumbnail);
      data.thumbnail = value;
      data.thumbnailBytes = dataUriBytes(value);
    }
    if (dto.category !== undefined) {
      data.category = normalizeNullable(dto.category);
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.stockDrawMode !== undefined) data.stockDrawMode = dto.stockDrawMode;
    if (dto.active !== undefined) data.active = dto.active;

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      select: PRODUCT_SCALARS,
    });

    // Chỉ dịch lại khi nội dung có bản dịch thực sự thay đổi — bật/tắt hiển thị
    // hay đổi thứ tự không cần gọi Claude API.
    const changed = TRANSLATABLE_FIELDS.some(
      (field) => updated[field] !== product[field],
    );
    if (changed) {
      void this.translation.translateProductSafe(id);
    }

    const changes = diffChanges(productSnapshot(product), productSnapshot(updated));
    await this.audit.log(
      actor,
      'product.update',
      { type: 'product', id },
      Object.keys(changes).length > 0
        ? { name: updated.name, changes }
        : { name: updated.name },
    );
    return this.loadProduct(id);
  }

  async deleteProduct(actor: User, id: string): Promise<{ success: boolean }> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { _count: { select: { orderItems: true } } },
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }
    if (product._count.orderItems > 0) {
      throw new ConflictException(K.adminProductHasOrders);
    }
    await this.prisma.product.delete({ where: { id } });
    await this.audit.log(
      actor,
      'product.delete',
      { type: 'product', id },
      { name: product.name },
    );
    return { success: true };
  }

  // ---------- Ảnh phụ của sản phẩm ----------

  /**
   * Thêm MỘT ảnh phụ vào cuối danh sách.
   *
   * Ảnh bìa tính vào hạn mức chung: đã có bìa thì chỉ còn
   * `PRODUCT_IMAGE_MAX_COUNT - 1` chỗ cho ảnh phụ. Hạn mức tồn tại vì ảnh nằm
   * base64 trong CSDL và đi theo cả 14 bản sao lưu.
   */
  async addProductImage(
    actor: User,
    productId: string,
    dto: AddProductImageDto,
  ): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        image: true,
        images: {
          select: { sortOrder: true },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        },
        _count: { select: { images: true } },
      },
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }

    const used = (product.image ? 1 : 0) + product._count.images;
    if (used >= PRODUCT_IMAGE_MAX_COUNT) {
      throw new BadRequestException(
        withParams(K.adminImageTooMany, { max: PRODUCT_IMAGE_MAX_COUNT }),
      );
    }

    const created = await this.prisma.productImage.create({
      data: {
        productId,
        data: dto.data,
        bytes: dataUriBytes(dto.data) ?? 0,
        sortOrder: (product.images[0]?.sortOrder ?? -1) + 1,
      },
      select: { id: true },
    });
    // Ghi độ dài chứ không ghi nội dung — xem chú thích ở `imageDigest`.
    await this.audit.log(
      actor,
      'product.image.add',
      { type: 'product', id: productId },
      { name: product.name, imageId: created.id, bytes: dataUriBytes(dto.data) },
    );
    return this.loadProduct(productId);
  }

  async deleteProductImage(actor: User, imageId: string): Promise<ProductDto> {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true, product: { select: { name: true } } },
    });
    if (!image) {
      throw new NotFoundException(K.adminImageNotFound);
    }
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.audit.log(
      actor,
      'product.image.delete',
      { type: 'product', id: image.productId },
      { name: image.product.name, imageId },
    );
    return this.loadProduct(image.productId);
  }

  /**
   * Sắp xếp lại ảnh phụ theo danh sách id gửi lên.
   *
   * Danh sách phải khớp CHÍNH XÁC tập ảnh hiện có. Thiếu một id thì ảnh đó giữ
   * `sortOrder` cũ và chen vào giữa thứ tự mới — sai lặng lẽ, chủ shop chỉ phát
   * hiện khi mở trang khách. Thà trả lỗi.
   */
  async reorderProductImages(
    actor: User,
    productId: string,
    dto: ReorderProductImagesDto,
  ): Promise<ProductDto> {
    const current = await this.prisma.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    const currentIds = new Set(current.map((row) => row.id));
    const wanted = new Set(dto.ids);
    if (
      wanted.size !== dto.ids.length ||
      wanted.size !== currentIds.size ||
      dto.ids.some((id) => !currentIds.has(id))
    ) {
      throw new BadRequestException(K.adminImageOrderMismatch);
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.productImage.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    await this.audit.log(
      actor,
      'product.image.reorder',
      { type: 'product', id: productId },
      { count: dto.ids.length },
    );
    return this.loadProduct(productId);
  }

  // ---------- Loại sản phẩm ----------

  async createVariant(
    actor: User,
    productId: string,
    dto: CreateVariantDto,
  ): Promise<ProductVariantDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true },
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }

    const variant = await this.prisma.productVariant.create({
      data: {
        productId,
        name: dto.name.trim(),
        ...(await this.chotGia(dto.price, dto.priceCurrency)),
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
      include: { translations: true },
    });

    // Loại mới chưa có bản dịch tên → dịch lại cả sản phẩm ở nền.
    void this.translation.translateProductSafe(productId);
    await this.audit.log(
      actor,
      'variant.create',
      { type: 'variant', id: variant.id },
      { name: variant.name, productName: product.name },
    );
    return toProductVariantDto(variant, { available: 0, sold: 0 }, {
      includeTranslations: true,
    });
  }

  /**
   * Chốt giá của một loại hàng: lưu con số chủ shop GÕ VÀO cùng đơn vị của nó,
   * và suy ra số USDT dùng cho mọi phép tính tiền.
   *
   * Neo bằng ₫ / ¥ mà cửa hàng chưa có tỉ giá thì THROW, không âm thầm lưu 0 —
   * một sản phẩm giá 0 là ai cũng lấy hàng miễn phí.
   */
  private async chotGia(
    soDaGo: number,
    donVi: DisplayCurrency | undefined,
  ): Promise<{
    price: Prisma.Decimal;
    priceCurrency: DisplayCurrency;
    priceAmount: Prisma.Decimal;
  }> {
    const neo: DisplayCurrency = donVi ?? 'USDT';
    const rates = await this.settings.getPublicRates();
    const usdt = toUsdtFromCurrency(soDaGo, neo, rates);
    if (usdt === null) {
      throw new BadRequestException(K.adminPriceAnchorNoRate);
    }
    return {
      // Làm tròn XUỐNG: số ₫ hiển thị dùng Math.ceil, nên làm tròn lên ở đây là
      // khách thấy 100.001 ₫ thay vì 100.000.
      price: new Prisma.Decimal(floorUsdt(usdt).toFixed(USDT_DECIMALS)),
      priceCurrency: neo,
      priceAmount: new Prisma.Decimal(soDaGo.toFixed(2)),
    };
  }

  async updateVariant(
    actor: User,
    id: string,
    dto: UpdateVariantDto,
  ): Promise<ProductVariantDto> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: { product: { select: { name: true } } },
    });
    if (!variant) {
      throw new NotFoundException(K.variantNotFound);
    }

    const data: Prisma.ProductVariantUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.price !== undefined) {
      /*
        Thiếu `priceCurrency` thì GIỮ neo cũ, không mặc định về USDT: trang quản
        trị cũ (hoặc một script) gửi mỗi `price` mà bị hiểu là USDT sẽ biến giá
        100.000 thành 100.000 USDT.
      */
      Object.assign(
        data,
        await this.chotGia(
          dto.price,
          dto.priceCurrency ?? layDonViNeo(variant.priceCurrency),
        ),
      );
    }
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data,
      include: { translations: true },
    });

    if (updated.name !== variant.name) {
      void this.translation.translateProductSafe(updated.productId);
    }

    const changes = diffChanges(
      {
        name: variant.name,
        // Ghi số ĐÃ GÕ kèm đơn vị, không ghi USDT: USDT của một giá neo theo ₫
        // tự đổi mỗi lần tỉ giá đổi, nhật ký sẽ đầy những thay đổi không ai làm.
        price: `${Number(variant.priceAmount)} ${variant.priceCurrency}`,
        sortOrder: variant.sortOrder,
        active: variant.active,
      },
      {
        name: updated.name,
        price: `${Number(updated.priceAmount)} ${updated.priceCurrency}`,
        sortOrder: updated.sortOrder,
        active: updated.active,
      },
    );
    await this.audit.log(
      actor,
      'variant.update',
      { type: 'variant', id },
      Object.keys(changes).length > 0
        ? { name: updated.name, productName: variant.product.name, changes }
        : { name: updated.name, productName: variant.product.name },
    );

    const counts = await getVariantStockCountMap(this.prisma, [id]);
    return toProductVariantDto(
      updated,
      counts.get(id) ?? { available: 0, sold: 0 },
      { includeTranslations: true },
    );
  }

  async deleteVariant(actor: User, id: string): Promise<{ success: boolean }> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      include: {
        _count: { select: { orderItems: true } },
        product: { select: { name: true } },
      },
    });
    if (!variant) {
      throw new NotFoundException(K.variantNotFound);
    }
    if (variant._count.orderItems > 0) {
      throw new ConflictException(K.adminVariantHasOrders);
    }
    const siblings = await this.prisma.productVariant.count({
      where: { productId: variant.productId },
    });
    if (siblings <= 1) {
      throw new BadRequestException(K.adminVariantLast);
    }
    await this.prisma.productVariant.delete({ where: { id } });
    await this.audit.log(
      actor,
      'variant.delete',
      { type: 'variant', id },
      { name: variant.name, productName: variant.product.name },
    );
    return { success: true };
  }

  // ---------- Kho hàng (theo loại) ----------

  async addStock(
    actor: User,
    variantId: string,
    dto: AddStockDto,
  ): Promise<AddStockResponse> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        name: true,
        active: true,
        price: true,
        priceCurrency: true,
        priceAmount: true,
        product: { select: { id: true, name: true, active: true } },
      },
    });
    if (!variant) {
      throw new NotFoundException(K.variantNotFound);
    }

    const lines = dto.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      throw new BadRequestException(K.adminStockMinOneLine);
    }

    const dedupe = dto.dedupe ?? true;
    let toInsert: string[];
    if (dedupe) {
      const existing = await this.prisma.stockItem.findMany({
        where: {
          variantId,
          status: { in: ['AVAILABLE', 'RESERVED'] },
        },
        select: { content: true },
      });
      const seen = new Set(existing.map((item) => item.content));
      toInsert = [];
      for (const line of lines) {
        if (seen.has(line)) continue;
        seen.add(line);
        toInsert.push(line);
      }
    } else {
      toInsert = lines;
    }

    const total = await this.prisma.$transaction(async (tx) => {
      if (toInsert.length > 0) {
        await tx.stockItem.createMany({
          data: toInsert.map((content) => ({ variantId, content })),
        });
      }
      const available = await tx.stockItem.count({
        where: { variantId, status: 'AVAILABLE' },
      });

      /*
       * Xếp thông báo trong CÙNG transaction với key mới: API chết sau commit
       * thì worker vẫn gửi được; transaction trượt thì tuyệt đối không có tin
       * "hàng mới" cho số key chưa từng vào kho.
       */
      if (toInsert.length > 0 && variant.active && variant.product.active) {
        const setting = await tx.storeSetting.findUnique({
          where: { id: 'main' },
          select: {
            telegramBotEnabled: true,
            telegramBotToken: true,
            telegramStockAlertsEnabled: true,
          },
        });
        if (
          setting?.telegramBotEnabled &&
          setting.telegramBotToken.trim() !== '' &&
          setting.telegramStockAlertsEnabled
        ) {
          const recipients = await tx.user.findMany({
            where: { role: 'USER', lockedAt: null, telegramChatId: { not: null } },
            select: { id: true, telegramLang: true },
          });
          if (recipients.length > 0) {
            await tx.telegramStockAlert.create({
              data: {
                productId: variant.product.id,
                productName: variant.product.name,
                variantName: variant.name,
                price: variant.price,
                priceCurrency: variant.priceCurrency,
                priceAmount: variant.priceAmount,
                added: toInsert.length,
                total: available,
                recipients: {
                  createMany: {
                    data: recipients.map((recipient) => ({
                      userId: recipient.id,
                      lang: recipient.telegramLang,
                    })),
                  },
                },
              },
            });
          }
        }
      }
      return available;
    });
    await this.audit.log(
      actor,
      'stock.add',
      { type: 'variant', id: variantId },
      {
        variantName: variant.name,
        productName: variant.product.name,
        added: toInsert.length,
      },
    );
    return {
      added: toInsert.length,
      skipped: lines.length - toInsert.length,
      total,
    };
  }


  /**
   * Chủ shop tự rút key ra khỏi kho để thu hồi.
   *
   * Đi qua ĐÚNG `lockAvailableStock` mà luồng đặt đơn dùng, trong MỘT
   * transaction. Nếu viết một truy vấn riêng cho việc rút tay thì lượt rút và
   * một đơn của khách có thể cùng lấy một dòng — khách trả tiền xong mới biết
   * key đã bị thu hồi, và đó là mất tiền thật.
   *
   * Rút được ÍT HƠN yêu cầu là chuyện bình thường (kho không đủ, hoặc vài dòng
   * đang bị đơn khác giữ): trả về số thực rút thay vì báo lỗi, để chủ shop biết
   * chính xác mình đang giữ những gì trong tay.
   */
  async withdrawStock(
    actor: User,
    variantId: string,
    dto: WithdrawStockDto,
  ): Promise<WithdrawStockResponse> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, product: { select: { name: true } } },
    });
    if (!variant) {
      throw new NotFoundException(K.variantNotFound);
    }

    const lines = await this.prisma.$transaction(async (tx) => {
      const ids = await this.fulfillment.lockAvailableStock(
        tx,
        variantId,
        dto.quantity,
        dto.mode ?? 'SEQUENTIAL',
      );
      if (ids.length === 0) return [];
      await tx.stockItem.updateMany({
        where: { id: { in: ids } },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      const rows = await tx.stockItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, content: true },
      });
      // Giữ đúng thứ tự đã rút — `findMany` không bảo đảm thứ tự của mảng `in`.
      const theoId = new Map(rows.map((row) => [row.id, row.content]));
      return ids.map((id) => ({ id, content: theoId.get(id) as string }));
    });

    if (lines.length === 0) {
      throw new BadRequestException(K.adminWithdrawNoStock);
    }

    const remaining = await this.prisma.stockItem.count({
      where: { variantId, status: 'AVAILABLE' },
    });
    // Nhật ký ghi SỐ LƯỢNG, không ghi nội dung key: nhật ký lưu vĩnh viễn và
    // hiện ở /admin/audit — nhét key vào đó là rò hàng ra một chỗ thứ hai.
    await this.audit.log(
      actor,
      'stock.withdraw',
      { type: 'variant', id: variantId },
      {
        variantName: variant.name,
        productName: variant.product.name,
        withdrawn: lines.length,
        requested: dto.quantity,
        mode: dto.mode ?? 'SEQUENTIAL',
        remaining,
      },
    );
    return { lines, withdrawn: lines.length, remaining };
  }

  /** Trả một dòng đã rút về lại kho — để một cú bấm lỡ tay không thành vĩnh viễn. */
  async restoreStock(actor: User, stockId: string): Promise<StockItemDto> {
    const item = await this.prisma.stockItem.findUnique({
      where: { id: stockId },
      select: {
        id: true,
        status: true,
        variantId: true,
        variant: { select: { name: true, product: { select: { name: true } } } },
      },
    });
    if (!item) {
      throw new NotFoundException(K.adminStockLineNotFound);
    }
    if (item.status !== 'WITHDRAWN') {
      throw new BadRequestException(K.adminStockNotWithdrawn);
    }

    /*
     * `updateMany` có điều kiện trạng thái, không dùng `update` trần: hai lần
     * bấm đồng thời thì lần thứ hai khớp 0 dòng thay vì ghi đè trạng thái mà
     * lần đầu đã đổi.
     */
    const { count } = await this.prisma.stockItem.updateMany({
      where: { id: stockId, status: 'WITHDRAWN' },
      data: { status: 'AVAILABLE', withdrawnAt: null },
    });
    if (count === 0) {
      throw new BadRequestException(K.adminStockNotWithdrawn);
    }

    await this.audit.log(
      actor,
      'stock.restore',
      { type: 'variant', id: item.variantId },
      {
        variantName: item.variant.name,
        productName: item.variant.product.name,
      },
    );

    const sau = await this.prisma.stockItem.findUniqueOrThrow({
      where: { id: stockId },
      include: { orderItem: { select: { order: { select: { code: true } } } } },
    });
    return {
      id: sau.id,
      content: sau.content,
      status: sau.status,
      createdAt: sau.createdAt.toISOString(),
      soldAt: sau.soldAt ? sau.soldAt.toISOString() : null,
      withdrawnAt: sau.withdrawnAt ? sau.withdrawnAt.toISOString() : null,
      orderCode: sau.orderItem?.order.code ?? null,
      variantId: sau.variantId,
      variantName: item.variant.name,
    };
  }

  async listStock(
    variantId: string,
    query: StockQueryDto,
  ): Promise<Paginated<StockItemDto>> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true },
    });
    if (!variant) {
      throw new NotFoundException(K.variantNotFound);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_STOCK_PAGE_SIZE;
    const where: Prisma.StockItemWhereInput = { variantId };
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.stockItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          orderItem: {
            select: { order: { select: { code: true } } },
          },
        },
      }),
      this.prisma.stockItem.count({ where }),
    ]);

    const items: StockItemDto[] = rows.map((row) => ({
      id: row.id,
      content: row.content,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      soldAt: row.soldAt ? row.soldAt.toISOString() : null,
      withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
      orderCode: row.orderItem?.order.code ?? null,
      variantId: row.variantId,
      variantName: variant.name,
    }));
    return { items, total };
  }

  async deleteStockItem(actor: User, id: string): Promise<{ success: boolean }> {
    const item = await this.prisma.stockItem.findUnique({
      where: { id },
      include: {
        variant: {
          select: { name: true, product: { select: { name: true } } },
        },
      },
    });
    if (!item) {
      throw new NotFoundException(K.adminStockLineNotFound);
    }
    if (item.status !== 'AVAILABLE') {
      throw new BadRequestException(K.adminStockOnlyAvailableDeletable);
    }
    await this.prisma.stockItem.delete({ where: { id } });
    await this.audit.log(
      actor,
      'stock.delete',
      { type: 'stock', id },
      {
        name: item.content,
        variantName: item.variant.name,
        productName: item.variant.product.name,
      },
    );
    return { success: true };
  }

  // ---------- Dịch tự động ----------

  async getTranslationStatus(): Promise<TranslationStatusDto> {
    return this.translation.getStatus();
  }

  /** Dịch ngay (có chờ) và trả về sản phẩm kèm bản dịch mới. */
  async translateProduct(actor: User, id: string): Promise<ProductDto> {
    await this.translation.translateProduct(id);
    const product = await this.loadProduct(id);
    await this.audit.log(
      actor,
      'product.translate',
      { type: 'product', id },
      { name: product.name },
    );
    return product;
  }

  // ---------- Đơn hàng ----------

  /** Bộ lọc dùng chung giữa danh sách đơn và bản xuất CSV — hai nơi phải khớp nhau. */
  private buildOrdersWhere(query: OrdersQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.userId) where.userId = query.userId;
    if (query.q) {
      // Cho phép tìm theo mã đơn, email hoặc mã khách hàng (có thể kèm dấu "#")
      const term = query.q.trim();
      const numeric = Number.parseInt(term.replace(/^#/, ''), 10);
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { user: { email: { contains: term, mode: 'insensitive' } } },
      ];
      if (Number.isSafeInteger(numeric)) {
        where.OR.push({ user: { code: numeric } });
      }
    }
    return where;
  }

  async listOrders(query: OrdersQueryDto): Promise<Paginated<OrderSummaryDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_ORDERS_PAGE_SIZE;
    const where = this.buildOrdersWhere(query);

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: { select: { productName: true } },
          user: { select: { email: true, code: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((order) => toOrderSummaryDto(order, order.user)),
      total,
    };
  }

  /**
   * Xuất đơn hàng ra CSV theo đúng bộ lọc đang xem trên trang quản trị.
   *
   * KHÔNG phân trang: mục đích là làm sổ sách và khai thuế, lấy nửa dữ liệu còn
   * tệ hơn không lấy. Chặn trần ở EXPORT_MAX_ROWS để một cửa hàng lâu năm không
   * kéo sập tiến trình bằng một cú bấm.
   */
  async exportOrdersCsv(query: OrdersQueryDto): Promise<string> {
    const where = this.buildOrdersWhere(query);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_MAX_ROWS,
      include: {
        items: { select: { productName: true, variantName: true, quantity: true } },
        user: { select: { email: true, code: true } },
        payment: { select: { mode: true, status: true } },
      },
    });

    return buildOrdersCsv(
      orders.map((order) => ({
        code: order.code,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        status: order.status,
        customerEmail: order.user.email,
        customerCode: order.user.code,
        subtotal: Number(order.subtotalAmount),
        discount: Number(order.discountAmount),
        total: Number(order.totalAmount),
        currency: order.currency,
        couponCode: order.couponCode,
        paymentMode: order.payment?.mode ?? null,
        paymentStatus: order.payment?.status ?? null,
        itemsCount: order.items.length,
        products: order.items
          .map((item) =>
            item.variantName
              ? `${item.productName} – ${item.variantName} x${item.quantity}`
              : `${item.productName} x${item.quantity}`,
          )
          .join('; '),
      })),
    );
  }

  async getOrderDetail(code: string): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { code },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            stockItems: { orderBy: { createdAt: 'asc' } },
            product: { select: { slug: true } },
          },
        },
        payment: true,
        user: { select: { email: true, code: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    return {
      ...toOrderDetailDto(order, { includeAllLines: true }),
      userId: order.userId,
      userEmail: order.user.email,
      userCode: order.user.code,
    };
  }

  /** Giao bù cho đơn PAID bị thiếu kho lúc thanh toán. */
  async redeliverOrder(actor: User, code: string): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    if (order.status !== 'PAID') {
      throw new BadRequestException(K.adminOnlyPaidRedeliver);
    }
    await this.fulfillment.deliverOrder(order.id);
    await this.audit.log(
      actor,
      'order.redeliver',
      { type: 'order', id: order.id },
      { code },
    );
    return this.getOrderDetail(code);
  }

  /**
   * Xác nhận đã nhận tiền NGOÀI hệ thống rồi giao hàng.
   *
   * Đây là van an toàn của cả cửa hàng: khách chuyển khoản ngân hàng, hoặc gửi
   * USDT mà bộ đối soát tự động không khớp được (sai mạng, gửi từ sàn gộp lệnh,
   * Binance API lỗi…). Trước khi có nút này, tiền đã vào tài khoản mà không có
   * cách nào giao hàng ngoài sửa tay cơ sở dữ liệu.
   *
   * Chỉ nhận đơn PENDING/EXPIRED — đơn đã PAID/DELIVERED gọi lại không làm gì
   * thêm (markPaidAndDeliver có chốt trạng thái), đơn CANCELLED thì phải để
   * khách đặt lại chứ không hồi sinh.
   */
  async markOrderPaid(
    actor: User,
    code: string,
    note?: string,
  ): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    if (order.status !== 'PENDING' && order.status !== 'EXPIRED') {
      throw new BadRequestException(K.adminCannotMarkPaid);
    }

    const result = await this.fulfillment.markPaidAndDeliver({
      orderId: order.id,
    });
    await this.audit.log(
      actor,
      'order.mark_paid',
      { type: 'order', id: order.id },
      {
        code,
        from: order.status,
        to: result?.status ?? 'PAID',
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    );
    return this.getOrderDetail(code);
  }

  /** Hủy đơn PENDING thay khách: nhả kho giữ chỗ, payment → FAILED. */
  async cancelOrder(actor: User, code: string): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!order) {
      throw new NotFoundException(K.orderNotFound);
    }
    if (order.status !== 'PENDING') {
      throw new BadRequestException(K.orderCannotCancel);
    }
    await this.fulfillment.cancelOrderInternal(order.id);
    await this.audit.log(
      actor,
      'order.cancel',
      { type: 'order', id: order.id },
      { code },
    );
    return this.getOrderDetail(code);
  }

  // ---------- Nội bộ ----------

  /** Một sản phẩm kèm bản dịch và ảnh phụ — dùng cho trang sửa. */
  async loadProduct(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: ADMIN_PRODUCT_DETAIL_SELECT,
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }
    const counts = await getVariantStockCountMap(
      this.prisma,
      collectVariantIds([product]),
    );
    return toProductDto(product, counts, { includeTranslations: true });
  }
}

/**
 * Cột `priceCurrency` là TEXT tự do; quy giá trị lạ về USDT — hành vi cũ, an
 * toàn nhất khi không rõ. Trùng ý với hàm cùng tên trong `product.mapper.ts`,
 * nhưng để riêng để `admin.service` không phụ thuộc vào tầng mapper.
 */
function layDonViNeo(value: string): DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly string[]).includes(value)
    ? (value as DisplayCurrency)
    : 'USDT';
}
