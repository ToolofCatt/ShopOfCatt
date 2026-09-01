import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { TranslationModule } from '../translation/translation.module';
import { AdminStorefrontController } from './admin-storefront.controller';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';

@Module({
  imports: [AuthModule, AuditModule, SettingsModule, TranslationModule],
  controllers: [StorefrontController, AdminStorefrontController, SetupController],
  providers: [StorefrontService, SetupService],
  exports: [StorefrontService, SetupService],
})
export class StorefrontModule {}
