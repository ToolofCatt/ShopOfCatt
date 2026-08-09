import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [OrdersModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
