import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

// AuthModule: controller dùng JwtAuthGuard (cần JwtService).
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
