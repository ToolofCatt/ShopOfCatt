import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { K } from '../i18n/messages';

export type FiveMailCategory = 'gmail-api' | 'gmail-account';
export interface FiveMailProduct { name:string; code:string; price:string; stock:number }
export interface FiveMailPurchase { orderNo:string; productCode:string; totalPrice:string; lines:string[] }

function decimal(value:unknown):string {
  if((typeof value!=='number'&&typeof value!=='string')||String(value).length>32)throw new Error('amount');
  const amount=new Prisma.Decimal(value);
  if(!amount.isFinite()||amount.isNegative()||amount.decimalPlaces()>6||amount.greaterThan(1_000_000))throw new Error('amount');
  return amount.toString();
}
function product(value:unknown):FiveMailProduct {
  if(!value||typeof value!=='object')throw new Error('product');
  const row=value as Record<string,unknown>;
  if(typeof row.name!=='string'||!row.name.trim()||row.name.length>300||typeof row.code!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(row.code)
    ||!Number.isSafeInteger(row.stock)||Number(row.stock)<0)throw new Error('product');
  return {name:row.name,code:row.code,price:decimal(row.price),stock:Number(row.stock)};
}

/** Adapter độc lập, chưa gắn route mua hoặc worker. Provider không có idempotency:
 * caller phải lưu intent trước buy và giữ UNKNOWN nếu kết quả không xác định. */
@Injectable()
export class FiveMailClient {
  private async request(token:string,path:'product/list'|'product/info'|'buy',params:Record<string,string>):Promise<unknown>{
    if(!token.trim())throw new BadRequestException(K.mailInvalid);
    const url=new URL('https://shop.5mail.io/shop/'+path);
    for(const [key,value] of Object.entries({...params,token:token.trim()}))url.searchParams.set(key,value);
    try {
      // URL chứa bí mật theo hợp đồng provider: không log URL, lỗi fetch hay body.
      // redirect:error chặn chuyển token sang host khác; tuyệt đối không retry buy.
      const response=await fetch(url.toString(),{method:'GET',headers:{Accept:'application/json','User-Agent':'DigitalStore/1.0','Cache-Control':'no-store'},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok||!response.body)throw new Error('response');
      const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000)throw new Error('limit');parts.push(value);}}finally{await reader.cancel();}
      const envelope=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(envelope?.code!==0)throw new Error('provider');
      return envelope.data;
    }catch{throw new BadGatewayException(K.mailProviderUnavailable);}
  }

  async list(token:string,category:FiveMailCategory):Promise<FiveMailProduct[]>{
    if(!['gmail-api','gmail-account'].includes(category))throw new BadRequestException(K.mailInvalid);
    const data=await this.request(token,'product/list',{category});
    try{if(!Array.isArray(data)||data.length>5000)throw new Error();const rows=data.map(product);if(new Set(rows.map(p=>p.code)).size!==rows.length)throw new Error();return rows;}
    catch{throw new BadGatewayException(K.mailProviderUnavailable);}
  }

  async info(token:string,productCode:string):Promise<FiveMailProduct>{
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(productCode))throw new BadRequestException(K.mailInvalid);
    const data=await this.request(token,'product/info',{productCode});
    try{const row=product(data);if(row.code!==productCode)throw new Error();return row;}
    catch{throw new BadGatewayException(K.mailProviderUnavailable);}
  }

  async buy(token:string,productCode:string,count:number):Promise<FiveMailPurchase>{
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(productCode)||!Number.isInteger(count)||count<1||count>100)throw new BadRequestException(K.mailInvalid);
    const data=await this.request(token,'buy',{productCode,count:String(count)});
    try{
      if(!data||typeof data!=='object')throw new Error();const row=data as Record<string,unknown>;
      if(typeof row.orderNo!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(row.orderNo)||row.productCode!==productCode||!Array.isArray(row.details)||row.details.length!==count)throw new Error();
      const totalPrice=decimal(row.totalPrice);
      const lines=row.details.map((detail:unknown)=>{
        if(!detail||typeof detail!=='object')throw new Error();const text=(detail as Record<string,unknown>).text;
        if(typeof text!=='string'||!text.trim()||text.length>100000)throw new Error();return text;
      });
      if(new Set(lines).size!==lines.length)throw new Error();
      return {orderNo:row.orderNo,productCode,totalPrice,lines};
    }catch{throw new BadGatewayException(K.mailProviderUnavailable);}
  }
}
