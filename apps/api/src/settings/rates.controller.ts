import { Controller, Get } from '@nestjs/common';
import type { StoreRatesDto } from '@webcatt/shared';
import { SettingsService } from './settings.service';

/**
 * Công khai — trang khách đọc tỉ giá để hiện giá theo ngôn ngữ đang chọn.
 *
 * Tách khỏi /store-info vì hai thứ đổi theo nhịp khác nhau: kênh liên hệ gần như
 * không đổi, còn tỉ giá đổi mỗi ngày.
 */
@Controller('rates')
export class RatesController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<StoreRatesDto> {
    return this.settingsService.getPublicRates();
  }
}
