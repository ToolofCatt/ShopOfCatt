import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { BalanceService } from './balance.service';

/**
 * Ví số dư của khách — không có controller: hiện chỉ bot Telegram (in-process)
 * và webhook SePay (qua PaymentsService) chạm vào ví.
 */
@Module({
  imports: [OrdersModule, SettingsModule],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
