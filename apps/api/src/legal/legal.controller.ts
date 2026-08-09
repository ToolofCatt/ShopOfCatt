import { Controller, Get, Param } from '@nestjs/common';
import type { LegalPageDto } from '@webcatt/shared';
import { LegalService } from './legal.service';

/** Công khai — khách đọc chính sách trước khi mua. */
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get(':slug')
  get(@Param('slug') slug: string): Promise<LegalPageDto> {
    return this.legal.getPublic(slug);
  }
}
