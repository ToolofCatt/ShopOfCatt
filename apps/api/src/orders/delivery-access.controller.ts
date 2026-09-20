import { Controller, Post, Headers, Header } from '@nestjs/common';
import { DeliveryAccessService } from './delivery-access.service';
import { RateLimit } from '../security/rate-limit.guard';

@Controller('delivery')
export class DeliveryAccessController {
  constructor(private readonly delivery:DeliveryAccessService){}

  @Post('view')
  @Header('Cache-Control','no-store, private')
  @Header('Pragma','no-cache')
  @Header('Referrer-Policy','no-referrer')
  @RateLimit({limit:30,windowMs:60_000,name:'delivery:view'})
  view(@Headers('authorization') authorization?:string){
    return this.delivery.read(authorization?.startsWith('Delivery ')?authorization.slice(9):'');
  }
}
