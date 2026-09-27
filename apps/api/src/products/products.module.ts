import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  // Bot Telegram gọi thẳng ProductsService (in-process) để dựng danh sách hàng.
  exports: [ProductsService],
})
export class ProductsModule {}
