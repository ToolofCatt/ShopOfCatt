import { Controller, Get, Param } from '@nestjs/common';
import type { ProductDto } from '@webcatt/shared';
import { ReqLocale } from '../i18n/locale.decorator';
import type { Locale } from '../i18n/locale';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@ReqLocale() locale: Locale): Promise<ProductDto[]> {
    return this.productsService.list(locale);
  }

  @Get(':slug')
  getBySlug(
    @Param('slug') slug: string,
    @ReqLocale() locale: Locale,
  ): Promise<ProductDto> {
    return this.productsService.getBySlug(slug, locale);
  }
}
