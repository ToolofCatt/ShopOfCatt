import { ArgumentsHost,Catch,HttpException,type ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request,Response } from 'express';
import { K,translate,isMessageKey } from '../i18n/messages';
import { resolveLocaleFromHeader } from '../i18n/locale';

const codes:Record<string,string>={
  [K.apiKeyInvalid]:'INVALID_API_KEY',[K.apiAccessDisabled]:'API_ACCESS_DISABLED',[K.apiScopeRequired]:'INSUFFICIENT_SCOPE',
  [K.apiIdempotencyRequired]:'IDEMPOTENCY_KEY_REQUIRED',[K.apiIdempotencyConflict]:'IDEMPOTENCY_CONFLICT',
  [K.apiPriceLimit]:'PRICE_LIMIT_EXCEEDED',[K.apiStoreUnavailable]:'STORE_UNAVAILABLE',[K.accountLocked]:'ACCOUNT_LOCKED',
  [K.balanceInsufficient]:'INSUFFICIENT_BALANCE',[K.orderInsufficientStock]:'INSUFFICIENT_STOCK',
  [K.orderNotFound]:'NOT_FOUND',[K.productNotFound]:'NOT_FOUND',[K.variantNotFound]:'NOT_FOUND',
  [K.tooManyRequests]:'RATE_LIMITED',[K.paymentNoMethodConfigured]:'PAYMENTS_UNAVAILABLE',[K.paymentMethodUnavailable]:'PAYMENT_METHOD_UNAVAILABLE',
};
export function partnerError(exception:unknown,request:Pick<Request,'headers'>){
  const locale=resolveLocaleFromHeader(request.headers['accept-language']);
  if(!(exception instanceof HttpException))return {status:500,code:'INTERNAL_ERROR',message:translate(K.internalError,locale)};
  const raw=exception.getResponse();
  const data=typeof raw==='string'?{message:raw}:raw as {message?:unknown;key?:string;params?:Record<string,string|number>};
  const candidate=typeof data.key==='string'?data.key:typeof data.message==='string'?data.message:K.apiRequestInvalid;
  const key=isMessageKey(candidate)?candidate:K.apiRequestInvalid;
  let status=exception.getStatus();
  if([K.balanceInsufficient,K.orderInsufficientStock,K.apiPriceLimit].includes(key as never))status=422;
  return {status,code:codes[key]??(status===400?'INVALID_REQUEST':status===401?'INVALID_API_KEY':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===429?'RATE_LIMITED':'REQUEST_REJECTED'),message:translate(key,locale,data.params??{})};
}
@Catch()
export class ApiV1ExceptionFilter implements ExceptionFilter {
  catch(exception:unknown,host:ArgumentsHost):void {
    const ctx=host.switchToHttp(),request=ctx.getRequest<Request>(),response=ctx.getResponse<Response>();
    const result=partnerError(exception,request);
    const retry=(exception as {retryAfterSeconds?:unknown}|null)?.retryAfterSeconds;
    if(typeof retry==='number')response.setHeader('Retry-After',String(retry));
    response.setHeader('Cache-Control','no-store');
    response.status(result.status).json({error:{code:result.code,message:result.message},requestId:randomUUID()});
  }
}
