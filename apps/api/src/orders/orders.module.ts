import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletCreditModule } from '../balance/wallet-credit.module';
import { CouponsModule } from '../coupons/coupons.module';
import { BinanceModule } from '../payments/binance.module';
import { SettingsModule } from '../settings/settings.module';
import { CryptoReconcileService } from './crypto-reconcile.service';
import { DeliverySweeperService } from './delivery-sweeper.service';
import { FulfillmentService } from './fulfillment.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  // WalletCreditModule: vòng đối soát crypto cộng ví mã nạp trong cùng tick
  // với đơn — module tí hon không import gì nên không tạo vòng với Balance.
  imports: [AuthModule, BinanceModule, SettingsModule, CouponsModule, WalletCreditModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    FulfillmentService,
    CryptoReconcileService,
    DeliverySweeperService,
  ],
  exports: [OrdersService, FulfillmentService],
})
export class OrdersModule {}
