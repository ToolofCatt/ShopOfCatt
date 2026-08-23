import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { AuthModule } from '../auth/auth.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramAdminController } from './telegram-admin.controller';
import { TelegramService } from './telegram.service';

/**
 * Kênh bán hàng qua bot Telegram — xem docs/BOT-TELEGRAM.md.
 * Bot nhận update bằng long-polling — không mở endpoint công khai nào; controller
 * duy nhất là API quản trị (guard admin) cho trang /admin/telegram.
 */
@Module({
  imports: [AuthModule, SettingsModule, ProductsModule, AnnouncementModule],
  controllers: [TelegramAdminController],
  providers: [TelegramService],
})
export class TelegramModule {}
