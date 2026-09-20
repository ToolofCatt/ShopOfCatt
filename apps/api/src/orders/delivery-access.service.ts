import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { DeliveryViewDto } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { K } from '../i18n/messages';

/** Link chỉ đọc đúng một đơn. Không dùng JWT đăng nhập: không thể đem link này
 * vào endpoint ví, đặt đơn hoặc admin. Fragment tránh log/referrer chứa token. */
@Injectable()
export class DeliveryAccessService {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly orders: OrdersService) {}

  private signature(payload: string): Buffer {
    const secret=this.config.get<string>('JWT_SECRET');
    if(!secret)throw new UnauthorizedException(K.sessionInvalid);
    return createHmac('sha256',secret).update('delivery-read-v1\0'+payload).digest();
  }

  async createLink(userId: string, code: string): Promise<string> {
    await this.load(userId,code);
    const payload=Buffer.from(JSON.stringify({u:userId,c:code,iat:Date.now(),exp:Date.now()+15*60_000,n:randomBytes(12).toString('hex')})).toString('base64url');
    const token=payload+'.'+this.signature(payload).toString('base64url');
    const origin=new URL(this.config.get<string>('WEB_URL') ?? 'http://localhost:3000');
    if(!['http:','https:'].includes(origin.protocol))throw new UnauthorizedException(K.sessionInvalid);
    return new URL('/delivery#'+token,origin).toString();
  }

  async read(token: string): Promise<DeliveryViewDto> {
    let grant: {u:string;c:string;exp:number;iat:number};
    try {
      if(token.length>2048||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error();
      const [payload,signature]=token.split('.');const actual=Buffer.from(signature,'base64url');const expected=this.signature(payload);
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error();
      grant=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
      if(typeof grant.u!=='string'||typeof grant.c!=='string'||!Number.isFinite(grant.exp)||grant.exp<=Date.now()
        ||!Number.isFinite(grant.iat)||grant.iat>Date.now()||grant.exp-grant.iat>15*60_000+1000)throw new Error();
    }catch{throw new UnauthorizedException(K.sessionInvalid);}
    return this.load(grant.u,grant.c,grant.iat);
  }

  private async load(userId:string,code:string,issuedAt?:number):Promise<DeliveryViewDto>{
    const user=await this.prisma.user.findUnique({where:{id:userId},select:{lockedAt:true,passwordChangedAt:true}});
    if(!user||user.lockedAt||(issuedAt&&user.passwordChangedAt&&user.passwordChangedAt.getTime()>issuedAt))throw new UnauthorizedException(K.sessionInvalid);
    const order=await this.orders.getOwnDetail(userId,code);
    if(order.status!=='DELIVERED')throw new NotFoundException(K.orderNotFound);
    return {code:order.code,items:order.items.map(item=>({name:item.productName,variant:item.variantName,lines:item.deliveredLines??[]}))};
  }
}
