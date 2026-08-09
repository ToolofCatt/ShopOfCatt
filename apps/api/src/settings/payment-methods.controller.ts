import { Controller, Get } from '@nestjs/common';
import type { PaymentMethodDto } from '@webcatt/shared';
import { SettingsService } from './settings.service';

/** Công khai — trang thanh toán đọc danh sách phương thức đang bật. */
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  list(): Promise<PaymentMethodDto[]> {
    return this.settingsService.getEnabledMethods();
  }
}
