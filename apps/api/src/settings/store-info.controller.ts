import { Controller, Get } from '@nestjs/common';
import type { PublicStoreInfoDto } from '@webcatt/shared';
import { SettingsService } from './settings.service';

/** Công khai — trang đăng nhập đọc kênh liên hệ cho mục "Quên mật khẩu". */
@Controller('store-info')
export class StoreInfoController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get(): Promise<PublicStoreInfoDto> {
    return this.settingsService.getSupportInfo();
  }
}
