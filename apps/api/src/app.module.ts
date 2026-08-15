import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BinanceExchangeModule } from './binance-exchange/binance-exchange.module';
import { CouponsModule } from './coupons/coupons.module';
import { CustomersModule } from './customers/customers.module';
import { HealthModule } from './health/health.module';
import { LegalModule } from './legal/legal.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { SecurityModule } from './security/security.module';
import { SettingsModule } from './settings/settings.module';
import { TranslationModule } from './translation/translation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SecurityModule,
    BinanceExchangeModule,
    HealthModule,
    AuthModule,
    ProductsModule,
    AnnouncementModule,
    TranslationModule,
    LegalModule,
    SettingsModule,
    CouponsModule,
    OrdersModule,
    PaymentsModule,
    AuditModule,
    AdminModule,
    CustomersModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
