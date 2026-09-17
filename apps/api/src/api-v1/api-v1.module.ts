import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { OrdersModule } from '../orders/orders.module';
import { BalanceModule } from '../balance/balance.module';
import { SettingsModule } from '../settings/settings.module';
import { ApiV1Controller,PartnerOpenApiController } from './api-v1.controller';
import { ApiV1Service } from './api-v1.service';

@Module({imports:[ApiKeysModule,OrdersModule,BalanceModule,SettingsModule],controllers:[ApiV1Controller,PartnerOpenApiController],providers:[ApiV1Service],exports:[ApiV1Service]})
export class ApiV1Module {}
