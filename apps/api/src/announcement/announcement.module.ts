import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TranslationModule } from '../translation/translation.module';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';

@Module({
  imports: [TranslationModule, AuditModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
