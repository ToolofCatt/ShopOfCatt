import { Controller, Get } from '@nestjs/common';
import type { AnnouncementDto } from '@webcatt/shared';
import type { Locale } from '../i18n/locale';
import { ReqLocale } from '../i18n/locale.decorator';
import { AnnouncementService } from './announcement.service';

@Controller('announcement')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Get()
  get(@ReqLocale() locale: Locale): Promise<AnnouncementDto> {
    return this.announcementService.getPublic(locale);
  }
}
