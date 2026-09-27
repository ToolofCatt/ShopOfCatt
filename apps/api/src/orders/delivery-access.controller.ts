import { Controller, Post, Headers, Header, UseGuards } from '@nestjs/common';
import { DeliveryAccessService } from './delivery-access.service';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';

@Controller('delivery')
export class DeliveryAccessController {
  constructor(private readonly delivery:DeliveryAccessService){}

  @Post('view')
  @UseGuards(RateLimitGuard)
  @Header('Cache-Control','no-store, private')
  @Header('Pragma','no-cache')
  @Header('Referrer-Policy','no-referrer')
  @RateLimit({limit:30,windowMs:60_000,name:'delivery:view'})
  view(@Headers('authorization') authorization?:string){
    return this.delivery.read(authorization?.startsWith('Delivery ')?authorization.slice(9):'');
  }
}
