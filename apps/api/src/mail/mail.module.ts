import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { FiveMailClient } from './fivemail.client';
import { MailCatalogService } from './mail-catalog.service';
import { MailInboxService } from './mail-inbox.service';
import { MailPurchaseService } from './mail-purchase.service';
import { MailController, AdminMailController } from './mail.controller';

@Module({ imports: [AuthModule, AuditModule], controllers: [MailController, AdminMailController], providers: [FiveMailClient, MailCatalogService, MailInboxService, MailPurchaseService] })
export class MailModule {}
