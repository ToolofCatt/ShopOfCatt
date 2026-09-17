import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,IsArray,IsIn,IsInt,IsOptional,IsString,Matches,Max,MaxLength,Min,MinLength,ValidateIf,ValidateNested } from 'class-validator';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PARTNER_DEPOSIT_METHODS,type PartnerDepositInput,type PartnerOrderInput,type PartnerDepositMethod } from '@webcatt/shared';
import { K } from '../i18n/messages';

export class PartnerOrderItemDto {
  @IsString({message:K.apiRequestInvalid}) @MinLength(1,{message:K.apiRequestInvalid}) @MaxLength(100,{message:K.apiRequestInvalid}) variantId:string;
  @IsInt({message:K.apiRequestInvalid}) @Min(1,{message:K.apiRequestInvalid}) @Max(100,{message:K.apiRequestInvalid}) quantity:number;
}
export class PartnerOrderInputDto implements PartnerOrderInput {
  @IsArray({message:K.apiRequestInvalid}) @ArrayMinSize(1,{message:K.apiRequestInvalid}) @ArrayMaxSize(20,{message:K.apiRequestInvalid}) @ValidateNested({each:true}) @Type(()=>PartnerOrderItemDto) items:PartnerOrderItemDto[];
  // Optional chỉ cho phép bỏ field, không nhận null: Decimal(null) từng thành 500
  // sau validation thay vì báo payload sai trước khi chạy nghiệp vụ.
  @ValidateIf((_object,value)=>value!==undefined) @IsString({message:K.apiRequestInvalid}) @MaxLength(32,{message:K.apiRequestInvalid}) couponCode?:string;
  @ValidateIf((_object,value)=>value!==undefined) @IsString({message:K.apiRequestInvalid}) @Matches(/^\d{1,12}(?:\.\d{1,6})?$/,{message:K.apiRequestInvalid}) maxTotalUsdt?:string;
}
export class PartnerDepositInputDto implements PartnerDepositInput {
  @IsIn(PARTNER_DEPOSIT_METHODS,{message:K.apiRequestInvalid}) method:PartnerDepositMethod;
  @IsInt({message:K.apiRequestInvalid}) @Min(10000,{message:K.apiRequestInvalid}) @Max(100000000,{message:K.apiRequestInvalid}) vndAmount:number;
}
export class PartnerPageDto {
  @IsOptional() @Type(()=>Number) @IsInt({message:K.apiRequestInvalid}) @Min(1,{message:K.apiRequestInvalid}) @Max(100000,{message:K.apiRequestInvalid}) page?:number;
  @IsOptional() @Type(()=>Number) @IsInt({message:K.apiRequestInvalid}) @Min(1,{message:K.apiRequestInvalid}) @Max(100,{message:K.apiRequestInvalid}) limit?:number;
}

export function requireIdempotencyKey(value: unknown):string {
  if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(value))throw new BadRequestException(K.apiIdempotencyRequired);
  return value;
}
export function canonicalOrder(input:PartnerOrderInput):PartnerOrderInput {
  const merged=new Map<string,number>();
  for(const item of input.items)merged.set(item.variantId,(merged.get(item.variantId)??0)+item.quantity);
  if([...merged.values()].reduce((sum,quantity)=>sum+quantity,0)>100)throw new BadRequestException(K.apiRequestInvalid);
  const coupon=input.couponCode?.trim().toUpperCase();
  return {items:[...merged].sort(([a],[b])=>a.localeCompare(b)).map(([variantId,quantity])=>({variantId,quantity})),...(coupon?{couponCode:coupon}:{}),...(input.maxTotalUsdt!==undefined?{maxTotalUsdt:new Prisma.Decimal(input.maxTotalUsdt).toFixed(6)}:{})};
}
export function canonicalDeposit(input:PartnerDepositInput):PartnerDepositInput{return {method:input.method,vndAmount:input.vndAmount};}
export function requestHash(input:PartnerOrderInput|PartnerDepositInput):string{return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
