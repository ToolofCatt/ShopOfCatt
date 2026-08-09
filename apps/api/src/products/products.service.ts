import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProductDto } from '@webcatt/shared';
import { FulfillmentService } from '../orders/fulfillment.service';
import { PrismaService } from '../prisma/prisma.service';
import {
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
   * Include dùng chung cho endpoint công khai: chỉ các loại đang bán,
   * kèm bản dịch đúng ngôn ngữ (với `vi` sẽ không có dòng nào → giữ bản gốc).
   */
  private publicInclude(locale: Locale) {
    return {
      variants: {
        where: { active: true },
        orderBy: VARIANT_ORDER_BY,
        include: { translations: { where: { locale } } },
      },
      translations: { where: { locale } },
    };
  }

  async list(locale: Locale): Promise<ProductDto[]> {
    await this.fulfillment.releaseExpiredOrders();
    const products = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: this.publicInclude(locale),
    });
    const counts = await getVariantStockCountMap(
      this.prisma,
      collectVariantIds(products),
    );
    return products.map((product) => toProductDto(product, counts, { locale }));
  }

  async getBySlug(slug: string, locale: Locale): Promise<ProductDto> {
    await this.fulfillment.releaseExpiredOrders();
    const product = await this.prisma.product.findFirst({
      where: { slug, active: true },
      include: this.publicInclude(locale),
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
