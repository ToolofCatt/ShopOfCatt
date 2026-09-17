import { BadRequestException,ConflictException,ForbiddenException,Injectable,Logger,NotFoundException,ServiceUnavailableException,UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Paginated,PartnerDepositDto,PartnerDepositInput,PartnerDepositMethodsDto,PartnerOrderDto,PartnerOrderInput,PartnerProductDto,PartnerWalletDto } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import type { ApiPrincipal } from '../api-keys/api-principal';
import { OrdersService } from '../orders/orders.service';
import { BalanceService,DEPOSIT_MIN_VND,DEPOSIT_MAX_VND,MAX_PENDING_DEPOSITS_PER_USER } from '../balance/balance.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import { SettingsService } from '../settings/settings.service';
import { FINANCIAL_TRANSACTION,lockFinancialArbitration } from '../common/financial-lock';
import { K } from '../i18n/messages';
import type { Locale } from '../i18n/locale';
import { canonicalDeposit,canonicalOrder,requestHash,requireIdempotencyKey,type PartnerPageDto } from './partner-request';

type Operation='orders.create'|'deposits.create';
const orderInclude={items:{include:{stockItems:{where:{status:'SOLD' as const},orderBy:{createdAt:'asc' as const}}}}} as const;
type OrderRow=Prisma.OrderGetPayload<{include:typeof orderInclude}>;

@Injectable()
export class ApiV1Service {
  private readonly logger=new Logger(ApiV1Service.name);
  constructor(private readonly prisma:PrismaService,private readonly apiKeys:ApiKeysService,private readonly orders:OrdersService,private readonly balance:BalanceService,private readonly fulfillment:FulfillmentService,private readonly settings:SettingsService){}

  async products(locale:Locale,slug?:string):Promise<PartnerProductDto[]>{
    const products=await this.prisma.product.findMany({
      where:{active:true,...(slug?{slug}:{})},orderBy:[{sortOrder:'asc'},{id:'asc'}],
      include:{
        translations:{where:{locale}},
        variants:{where:{active:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],include:{
          translations:{where:{locale}},_count:{select:{stockItems:{where:{status:'AVAILABLE'}}}},
        }},
      },
    });
    if(slug&&products.length===0)throw new NotFoundException(K.productNotFound);
    return products.map(p=>({id:p.id,slug:p.slug,name:p.translations[0]?.name??p.name,description:p.translations[0]?.description??p.description,category:p.translations[0]?.category??p.category,variants:p.variants.map(v=>({id:v.id,name:v.translations[0]?.name??v.name,price:v.price.toFixed(6),currency:'USDT',availableStock:v._count.stockItems}))}));
  }
  async wallet(ownerId:string):Promise<PartnerWalletDto>{const user=await this.prisma.user.findUnique({where:{id:ownerId},select:{balance:true}});if(!user)throw new NotFoundException(K.apiAccountNotFound);return {balance:user.balance.toFixed(6),currency:'USDT'};}
  async depositMethods():Promise<PartnerDepositMethodsDto>{return {methods:await this.balance.listDepositMethods(),minVnd:DEPOSIT_MIN_VND,maxVnd:DEPOSIT_MAX_VND,maxPending:MAX_PENDING_DEPOSITS_PER_USER};}

  private async receipt(tx:Prisma.TransactionClient,ownerId:string,operation:Operation,key:string,hash:string){
    const receipt=await tx.apiOperationReceipt.findUnique({where:{ownerId_operation_idempotencyKey:{ownerId,operation,idempotencyKey:key}}});
    if(receipt&&receipt.requestHash!==hash)throw new ConflictException(K.apiIdempotencyConflict);
    return receipt;
  }
  private async assertStore(tx:Prisma.TransactionClient){
    await tx.$queryRaw`SELECT id FROM "StoreSetup" WHERE id = 'main' FOR SHARE`;
    const setup=await tx.storeSetup.findUnique({where:{id:'main'},select:{maintenanceMode:true,publishedRevisionId:true}});
    if(!setup||setup.maintenanceMode||!setup.publishedRevisionId)throw new ServiceUnavailableException(K.apiStoreUnavailable);
  }

  async purchase(principal:ApiPrincipal,input:PartnerOrderInput,idempotency:unknown):Promise<{data:PartnerOrderDto;replayed:boolean}>{
    const key=requireIdempotencyKey(idempotency),body=canonicalOrder(input),hash=requestHash(body);
    const result=await this.prisma.$transaction(async tx=>{
      await lockFinancialArbitration(tx);
      await this.apiKeys.revalidateInTransaction(tx,principal,'orders:write');
      const previous=await this.receipt(tx,principal.ownerId,'orders.create',key,hash);
      if(previous?.orderId)return {orderId:previous.orderId,replayed:true};
      await this.assertStore(tx);
      // Không bypass cấu hình fail-closed của shop, nhưng không mở một phiên gateway để mua bằng ví.
      const snapshot=await this.settings.lockPaymentSetting(tx);
      const enabled=await this.settings.getEnabledMethods(snapshot);
      if(enabled.length===0)throw new ServiceUnavailableException(K.paymentNoMethodConfigured);
      const prepared=await this.orders.createPendingOrderInTransaction(tx,{id:principal.ownerId},{items:body.items,...(body.couponCode?{couponCode:body.couponCode}:{})},'BALANCE');
      if(body.maxTotalUsdt!==undefined&&prepared.total.gt(new Prisma.Decimal(body.maxTotalUsdt)))throw new UnprocessableEntityException(K.apiPriceLimit);
      await this.balance.payOrderInTransaction(tx,principal.ownerId,prepared.orderId,{requireUnlockedUser:true});
      await this.orders.reserveOrderStockInTransaction(tx,prepared);
      await tx.apiOperationReceipt.create({data:{ownerId:principal.ownerId,operation:'orders.create',idempotencyKey:key,requestHash:hash,orderId:prepared.orderId}});
      return {orderId:prepared.orderId,replayed:false};
    },FINANCIAL_TRANSACTION);
    try{await this.fulfillment.deliverOrder(result.orderId);}catch{this.logger.warn(`Đơn API ${result.orderId} đã trả ví, đang chờ giao lại`);}
    const row=await this.prisma.order.findFirst({where:{id:result.orderId,userId:principal.ownerId},include:orderInclude});
    if(!row)throw new NotFoundException(K.orderNotFound);
    return {data:this.orderDto(row,false),replayed:result.replayed};
  }

  async createDeposit(principal:ApiPrincipal,input:PartnerDepositInput,idempotency:unknown):Promise<{data:PartnerDepositDto;replayed:boolean}>{
    const key=requireIdempotencyKey(idempotency),body=canonicalDeposit(input),hash=requestHash(body);
    const result=await this.prisma.$transaction(async tx=>{
      await lockFinancialArbitration(tx);await this.apiKeys.revalidateInTransaction(tx,principal,'deposits:write');
      // Replay đi trước cấu hình mới; request mới giữ snapshot tới commit thay vì
      // dùng receiver/tỉ giá đã đọc trước khi chờ khóa rồi mới cấp mã nạp.
      const previous=await this.receipt(tx,principal.ownerId,'deposits.create',key,hash);
      if(previous?.depositId)return {depositId:previous.depositId,replayed:true};
      await this.assertStore(tx);
      const snapshot=await this.settings.lockPaymentSetting(tx);
      const prepared=await this.balance.prepareDeposit(principal.ownerId,body.vndAmount,body.method,snapshot);
      const deposit=await this.balance.createDepositInTransaction(tx,principal.ownerId,prepared);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${principal.ownerId} FOR UPDATE`;
      const owner=await tx.user.findUniqueOrThrow({where:{id:principal.ownerId},select:{lockedAt:true}});
      if(owner.lockedAt)throw new ForbiddenException(K.accountLocked);
      await tx.apiOperationReceipt.create({data:{ownerId:principal.ownerId,operation:'deposits.create',idempotencyKey:key,requestHash:hash,depositId:deposit.id}});
      return {depositId:deposit.id,replayed:false};
    },FINANCIAL_TRANSACTION);
    return {data:await this.loadDeposit(principal.ownerId,result.depositId),replayed:result.replayed};
  }

  async listOrders(ownerId:string,query:PartnerPageDto):Promise<Paginated<PartnerOrderDto>>{
    const where:Prisma.OrderWhereInput={userId:ownerId,apiReceipt:{is:{ownerId,operation:'orders.create'}}};
    const [rows,total]=await Promise.all([this.prisma.order.findMany({where,include:orderInclude,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:((query.page??1)-1)*(query.limit??20),take:query.limit??20}),this.prisma.order.count({where})]);
    return {items:rows.map(row=>this.orderDto(row,false)),total};
  }
  async getOrder(ownerId:string,code:string):Promise<PartnerOrderDto>{
    const order=await this.prisma.order.findFirst({where:{code,userId:ownerId,apiReceipt:{is:{ownerId,operation:'orders.create'}}},include:orderInclude});
    if(!order)throw new NotFoundException(K.orderNotFound);return this.orderDto(order,true);
  }
  async listDeposits(ownerId:string,query:PartnerPageDto):Promise<Paginated<PartnerDepositDto>>{
    const where:Prisma.DepositWhereInput={userId:ownerId,apiReceipt:{is:{ownerId,operation:'deposits.create'}}};
    const [rows,total]=await Promise.all([this.prisma.deposit.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:((query.page??1)-1)*(query.limit??20),take:query.limit??20}),this.prisma.deposit.count({where})]);
    return {items:rows.map(row=>this.depositDto(row)),total};
  }
  async getDeposit(ownerId:string,code:string):Promise<PartnerDepositDto>{
    const row=await this.prisma.deposit.findFirst({where:{code,userId:ownerId,apiReceipt:{is:{ownerId,operation:'deposits.create'}}}});
    if(!row)throw new NotFoundException(K.orderNotFound);return this.depositDto(row);
  }
  private async loadDeposit(ownerId:string,id:string):Promise<PartnerDepositDto>{
    const row=await this.prisma.deposit.findFirst({where:{id,userId:ownerId}});if(!row)throw new NotFoundException(K.orderNotFound);return this.depositDto(row);
  }
  private orderDto(row:OrderRow,includeGoods:boolean):PartnerOrderDto{return {code:row.code,status:row.status,totalAmount:row.totalAmount.toFixed(6),currency:'USDT',createdAt:row.createdAt.toISOString(),paidAt:row.paidAt?.toISOString()??null,items:row.items.map(item=>({variantId:item.variantId,productName:item.productName,variantName:item.variantName,unitPrice:item.unitPrice.toFixed(6),quantity:item.quantity,...(includeGoods&&['PAID','DELIVERED'].includes(row.status)?{deliveredLines:item.stockItems.map(stock=>stock.content)}:{})}))};}
  private depositDto(row:Prisma.DepositGetPayload<object>):PartnerDepositDto{return {code:row.code,status:row.status,method:row.mode==='SEPAY'?'sepay':row.mode==='BINANCE_ID'?'binance_id':row.cryptoNetwork==='BEP20'?'crypto_bep20':'crypto_trc20',amountUsdt:row.amountUsdt.toFixed(6),vndAmount:row.vndAmount.toFixed(0),createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),paidAt:row.paidAt?.toISOString()??null,instructions:{network:row.cryptoNetwork,address:row.cryptoAddress,bank:row.sepayBank,accountHolder:row.sepayAccountHolder,memo:row.mode==='CRYPTO'?null:row.code}};}
}
