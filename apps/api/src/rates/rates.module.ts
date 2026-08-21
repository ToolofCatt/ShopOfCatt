import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { ExchangeRateService } from './exchange-rate.service';

/** Tự lấy tỉ giá USD → VND/CNY mỗi ngày. */
@Module({
  imports: [SettingsModule],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class RatesModule {}
