import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../balance/balance.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { BinanceModule } from './binance.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

// AuthModule: mock/confirm dùng JwtAuthGuard (cần JwtService).
@Module({
  imports: [OrdersModule, BinanceModule, AuthModule, SettingsModule, BalanceModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  // Bot Telegram dùng confirmMock cho cổng giả lập (in-process, không qua HTTP).
  exports: [PaymentsService],
})
export class PaymentsModule {}
