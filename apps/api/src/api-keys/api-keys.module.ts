import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { AccountApiKeysController } from './account-api-keys.controller';
import { AdminApiKeysController } from './admin-api-keys.controller';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaService } from './api-quota.service';

@Module({
  imports: [AuthModule, PrismaModule, SecurityModule],
  controllers: [AccountApiKeysController, AdminApiKeysController],
  providers: [ApiKeysService, ApiQuotaService, ApiKeyGuard],
  exports: [ApiKeysService, ApiQuotaService, ApiKeyGuard],
})
export class ApiKeysModule {}
