import { Module } from '@nestjs/common';
import { WalletCreditService } from './wallet-credit.service';

/**
 * Module con TÍ HON, cố ý không import gì: cả BalanceModule lẫn OrdersModule
 * (vòng đối soát crypto) đều cần cộng ví, mà hai module đó import lẫn nhau là
 * vòng tròn — nên phần cộng ví đứng riêng ở đây cho cả hai cùng import.
 */
@Module({
  providers: [WalletCreditService],
  exports: [WalletCreditService],
})
export class WalletCreditModule {}
