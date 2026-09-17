import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,Res,UseFilters,UseGuards,UsePipes,ValidationPipe } from '@nestjs/common';
import type { Request,Response } from 'express';
import { PARTNER_OPENAPI } from '@webcatt/shared';
import { ApiKeyGuard } from '../api-keys/api-key.guard';
import { ApiScopes } from '../api-keys/api-scopes.decorator';
import type { ApiPrincipal } from '../api-keys/api-principal';
import { resolveLocaleFromHeader } from '../i18n/locale';
import { ApiV1ExceptionFilter } from './api-v1.filter';
import { ApiV1Service } from './api-v1.service';
import { PartnerDepositInputDto,PartnerOrderInputDto,PartnerPageDto } from './partner-request';

type PartnerRequest=Request&{apiPrincipal:ApiPrincipal};
@Controller('v1')
@UseGuards(ApiKeyGuard)
@UseFilters(ApiV1ExceptionFilter)
@UsePipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}))
export class ApiV1Controller {
  constructor(private readonly service:ApiV1Service){}
  @Get('products') @ApiScopes('catalog:read') @Header('Cache-Control','no-store')
  products(@Req()req:PartnerRequest){return this.service.products(resolveLocaleFromHeader(req.headers['accept-language']));}
  @Get('products/:slug') @ApiScopes('catalog:read') @Header('Cache-Control','no-store')
  async product(@Req()req:PartnerRequest,@Param('slug')slug:string){return (await this.service.products(resolveLocaleFromHeader(req.headers['accept-language']),slug))[0];}
  @Get('wallet') @ApiScopes('wallet:read') @Header('Cache-Control','no-store')
  wallet(@Req()req:PartnerRequest){return this.service.wallet(req.apiPrincipal.ownerId);}
  @Get('deposit-methods') @ApiScopes('deposits:read') @Header('Cache-Control','no-store')
  methods(){return this.service.depositMethods();}
  @Get('deposits') @ApiScopes('deposits:read') @Header('Cache-Control','no-store')
  deposits(@Req()req:PartnerRequest,@Query()query:PartnerPageDto){return this.service.listDeposits(req.apiPrincipal.ownerId,query);}
  @Get('deposits/:code') @ApiScopes('deposits:read') @Header('Cache-Control','no-store')
  deposit(@Req()req:PartnerRequest,@Param('code')code:string){return this.service.getDeposit(req.apiPrincipal.ownerId,code);}
  @Post('deposits') @ApiScopes('deposits:write') @Header('Cache-Control','no-store')
  async createDeposit(@Req()req:PartnerRequest,@Body()body:PartnerDepositInputDto,@Headers('idempotency-key')key:unknown,@Res({passthrough:true})response:Response){
    const result=await this.service.createDeposit(req.apiPrincipal,body,key);response.status(result.replayed?200:201);response.setHeader('Idempotency-Replayed',String(result.replayed));return result.data;
  }
  @Get('orders') @ApiScopes('orders:read') @Header('Cache-Control','no-store')
  orders(@Req()req:PartnerRequest,@Query()query:PartnerPageDto){return this.service.listOrders(req.apiPrincipal.ownerId,query);}
  @Get('orders/:code') @ApiScopes('orders:read') @Header('Cache-Control','no-store')
  order(@Req()req:PartnerRequest,@Param('code')code:string){return this.service.getOrder(req.apiPrincipal.ownerId,code);}
  @Post('orders') @ApiScopes('orders:write') @Header('Cache-Control','no-store')
  async purchase(@Req()req:PartnerRequest,@Body()body:PartnerOrderInputDto,@Headers('idempotency-key')key:unknown,@Res({passthrough:true})response:Response){
    const result=await this.service.purchase(req.apiPrincipal,body,key);response.status(result.replayed?200:201);response.setHeader('Idempotency-Replayed',String(result.replayed));return result.data;
  }
}
@Controller('v1')
export class PartnerOpenApiController {
  @Get('openapi.json') @Header('Cache-Control','public, max-age=300')
  openapi(){return PARTNER_OPENAPI;}
}
