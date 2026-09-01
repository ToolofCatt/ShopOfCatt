import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { PublicStorefrontDto } from '@webcatt/shared';
import type { Response } from 'express';
import { StorefrontService } from './storefront.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
  get(): Promise<PublicStorefrontDto> {
    return this.storefront.getPublic();
  }

  @Get('media/:id')
  async media(@Param('id') id: string, @Res() response: Response): Promise<void> {
    const media = await this.storefront.getMedia(id);
    response.set({
      'Content-Type': media.contentType,
      'Content-Length': String(media.bytes),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(media.data);
  }
}
