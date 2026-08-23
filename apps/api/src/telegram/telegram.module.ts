import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TelegramService } from './telegram.service';

/**
 * Kênh bán hàng qua bot Telegram — xem docs/BOT-TELEGRAM.md.
 * Không có controller: bot nhận update bằng long-polling, không mở endpoint nào.
 */
@Module({
  imports: [SettingsModule],
  providers: [TelegramService],
})
export class TelegramModule {}
