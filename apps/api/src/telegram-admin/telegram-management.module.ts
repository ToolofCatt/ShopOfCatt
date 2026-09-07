import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { CustomersModule } from '../customers/customers.module';
import { CouponsModule } from '../coupons/coupons.module';
import { AnnouncementModule } from '../announcement/announcement.module';
import { LegalModule } from '../legal/legal.module';
import {
  TelegramAdminAccessController,
  TelegramAdminPreviewController,
} from './access.controller';
import { TelegramAdminAccessService } from './access.service';
import { TelegramAdminActionsService } from './actions.service';
import { TelegramAdminScreensService } from './screens.service';
import { TelegramAdminBotService } from './bot.service';

@Module({
  imports: [
    AdminModule,
    AuditModule,
    AuthModule,
    SettingsModule,
    CustomersModule,
    CouponsModule,
    AnnouncementModule,
    LegalModule,
  ],
  controllers: [TelegramAdminAccessController, TelegramAdminPreviewController],
  providers: [
    TelegramAdminAccessService,
    TelegramAdminActionsService,
    TelegramAdminScreensService,
    TelegramAdminBotService,
  ],
  exports: [TelegramAdminBotService],
})
export class TelegramManagementModule {}
