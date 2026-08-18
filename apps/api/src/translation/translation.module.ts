import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TranslationService } from './translation.service';

/**
 * SettingsModule vào đây để lấy khoá Claude API chủ shop lưu trong CSDL.
 * Không sinh vòng lặp: SettingsModule chỉ phụ thuộc AuditModule.
 */
@Module({
  imports: [SettingsModule],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}
