import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BalanceModule } from '../balance/balance.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { TelegramAdminController } from './telegram-admin.controller';
import { TelegramUsersService } from './telegram-users.service';
import { TelegramService } from './telegram.service';

/**
 * Kênh bán hàng qua bot Telegram — xem docs/BOT-TELEGRAM.md.
 * Bot nhận update bằng long-polling — không mở endpoint công khai nào; controller
 * duy nhất là API quản trị (guard admin) cho trang /admin/telegram.
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    BalanceModule,
    SettingsModule,
    ProductsModule,
    AnnouncementModule,
    OrdersModule,
    PaymentsModule,
    StorefrontModule,
  ],
  controllers: [TelegramAdminController],
  providers: [TelegramService, TelegramUsersService],
})
export class TelegramModule {}
