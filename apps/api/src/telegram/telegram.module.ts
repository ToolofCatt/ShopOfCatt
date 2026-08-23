import { Module } from '@nestjs/common';
import { AnnouncementModule } from '../announcement/announcement.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramService } from './telegram.service';

/**
 * Kênh bán hàng qua bot Telegram — xem docs/BOT-TELEGRAM.md.
 * Không có controller: bot nhận update bằng long-polling, không mở endpoint nào.
 */
@Module({
  imports: [SettingsModule, ProductsModule, AnnouncementModule],
  providers: [TelegramService],
})
export class TelegramModule {}
