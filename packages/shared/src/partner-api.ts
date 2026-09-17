import type { OrderStatus } from './index';

export type PartnerDepositStatus = 'PENDING'|'SUCCESS'|'EXPIRED'|'CANCELLED';

export const API_SCOPES = ['catalog:read','wallet:read','deposits:read','deposits:write','orders:read','orders:write'] as const;
export type ApiScope = typeof API_SCOPES[number];
export const API_KEY_DEFAULT_DAYS = 30;
export const API_KEY_MAX_DAYS = 90;
export const API_KEY_MAX_ACTIVE = 5;
export interface ApiKeyDto {
  id:string;name:string;prefix:string;scopes:ApiScope[];createdAt:string;expiresAt:string;revokedAt:string|null;lastUsedAt:string|null;
}
export interface ApiAccessDto { enabled:boolean;approvedAt:string|null;disabledAt:string|null; }
export interface AccountApiDto { access:ApiAccessDto;keys:ApiKeyDto[];balance:string;currency:'USDT'; }
export interface CreatedApiKeyDto { key:ApiKeyDto;secret:string; }
export interface ApiAccountDto { userId:string;code:number;email:string|null;name:string;locked:boolean;access:ApiAccessDto;activeKeys:number; }
export interface PartnerWalletDto { balance:string;currency:'USDT'; }
export interface PartnerProductDto {
  id:string;slug:string;name:string;description:string|null;category:string|null;
  variants:{id:string;name:string;price:string;currency:'USDT';availableStock:number}[];
}
export interface PartnerOrderInput {items:{variantId:string;quantity:number}[];couponCode?:string;maxTotalUsdt?:string;}
export interface PartnerOrderDto {
  code:string;status:OrderStatus;totalAmount:string;currency:'USDT';createdAt:string;paidAt:string|null;
  items:{variantId:string|null;productName:string;variantName:string;unitPrice:string;quantity:number;deliveredLines?:string[]}[];
}
export const PARTNER_DEPOSIT_METHODS=['sepay','crypto_bep20','crypto_trc20','binance_id'] as const;
export type PartnerDepositMethod=typeof PARTNER_DEPOSIT_METHODS[number];
export interface PartnerDepositInput {method:PartnerDepositMethod;vndAmount:number;}
export interface PartnerDepositDto {
  code:string;status:PartnerDepositStatus;method:PartnerDepositMethod;amountUsdt:string;vndAmount:string;createdAt:string;expiresAt:string;paidAt:string|null;
  instructions:{network:string|null;address:string|null;bank:string|null;accountHolder:string|null;memo:string|null};
}
export interface PartnerDepositMethodsDto { methods:PartnerDepositMethod[];minVnd:number;maxVnd:number;maxPending:number; }
export interface PartnerApiErrorDto {error:{code:string;message:string};requestId:string;}
