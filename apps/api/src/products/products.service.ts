import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProductDto } from '@webcatt/shared';
import { FulfillmentService } from '../orders/fulfillment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PRODUCT_IMAGE_META_SELECT,
  PRODUCT_SCALARS,
  VARIANT_ORDER_BY,
  collectVariantIds,
  getVariantStockCountMap,
  toProductDto,
} from './product.mapper';
import { K } from '../i18n/messages';
import type { Locale } from '../i18n/locale';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  /**
   * Loại đang bán + bản dịch đúng ngôn ngữ, dùng chung cho hai truy vấn dưới
   * (với `vi` sẽ không có dòng dịch nào → giữ bản gốc).
   */
  private publicRelations(locale: Locale) {
    return {
      variants: {
        where: { active: true },
        orderBy: VARIANT_ORDER_BY,
        include: { translations: { where: { locale } } },
      },
      translations: { where: { locale } },
    };
  }

  /**
   * Trang chi tiết: kèm phần MÔ TẢ của ảnh phụ (id, cỡ, thứ tự) — không kèm dữ
   * liệu ảnh. Trình duyệt tự tải ảnh qua `/api/images/...` và cache lại.
   */
  private publicDetailSelect(locale: Locale) {
    return {
      ...PRODUCT_SCALARS,
      ...this.publicRelations(locale),
      images: { select: PRODUCT_IMAGE_META_SELECT, orderBy: { sortOrder: 'asc' as const } },
    };
  }

  /** Danh sách: không cần ảnh phụ, thẻ sản phẩm chỉ dùng ảnh nhỏ. */
  private publicListSelect(locale: Locale) {
    return { ...PRODUCT_SCALARS, ...this.publicRelations(locale) };
  }

  async list(locale: Locale): Promise<ProductDto[]> {
    await this.fulfillment.releaseExpiredOrders();
    const products = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: this.publicListSelect(locale),
    });
    const counts = await getVariantStockCountMap(
      this.prisma,
      collectVariantIds(products),
    );
    /*
     * Hàng còn bán đứng trước hàng đã hết.
     *
     * Không xếp được ở tầng CSDL vì tồn kho là kết quả đếm dòng StockItem, không
     * phải một cột. Trước đây trang chủ xếp thuần theo sortOrder/ngày tạo, nên ô
     * đầu tiên khách nhìn thấy có thể là một sản phẩm HẾT HÀNG — bấm vào chỉ để
     * thất vọng. Sort của JS ổn định nên thứ tự sortOrder/ngày tạo vẫn được giữ
     * bên trong từng nhóm.
     */
    return products
      .map((product) => toProductDto(product, counts, { locale }))
      .sort((a, b) => Number(b.availableStock > 0) - Number(a.availableStock > 0));
  }

  async getBySlug(slug: string, locale: Locale): Promise<ProductDto> {
    await this.fulfillment.releaseExpiredOrders();
    const product = await this.prisma.product.findFirst({
      where: { slug, active: true },
      select: this.publicDetailSelect(locale),
    });
    if (!product) {
      throw new NotFoundException(K.productNotFound);
    }
    const counts = await getVariantStockCountMap(
      this.prisma,
      collectVariantIds([product]),
    );
    return toProductDto(product, counts, { locale });
  }
}
