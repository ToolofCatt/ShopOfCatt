import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentMethodsController } from './payment-methods.controller';
import { SettingsService } from './settings.service';
import { StoreInfoController } from './store-info.controller';

/** Cấu hình cửa hàng + endpoint công khai /api/payment-methods, /api/store-info. */
@Module({
  imports: [AuditModule],
  controllers: [PaymentMethodsController, StoreInfoController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
