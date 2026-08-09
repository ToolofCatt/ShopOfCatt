import { Global, Module } from '@nestjs/common';
import { BinanceExchangeService } from './binance-exchange.service';

/** Global để orders/admin đều tiêm được BinanceExchangeService. */
@Global()
@Module({
  providers: [BinanceExchangeService],
  exports: [BinanceExchangeService],
})
export class BinanceExchangeModule {}
