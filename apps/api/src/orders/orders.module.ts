import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CouponsModule } from '../coupons/coupons.module';
import { BinanceModule } from '../payments/binance.module';
import { SettingsModule } from '../settings/settings.module';
import { CryptoReconcileService } from './crypto-reconcile.service';
import { FulfillmentService } from './fulfillment.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, BinanceModule, SettingsModule, CouponsModule],
  controllers: [OrdersController],
  providers: [OrdersService, FulfillmentService, CryptoReconcileService],
  exports: [OrdersService, FulfillmentService],
})
export class OrdersModule {}
