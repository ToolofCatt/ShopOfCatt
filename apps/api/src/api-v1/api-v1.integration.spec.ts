import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { ApiV1Service } from './api-v1.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ApiQuotaService } from '../api-keys/api-quota.service';
import { OrdersService } from '../orders/orders.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import { BalanceService } from '../balance/balance.service';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { SettingsService } from '../settings/settings.service';
import { CouponsService } from '../coupons/coupons.service';
import { AuditService } from '../audit/audit.service';
import { API_SCOPES } from '@webcatt/shared';
import type { ApiPrincipal } from '../api-keys/api-principal';

const base=process.env.PARTNER_TRANSACTION_TEST_DATABASE_URL;
const database='partner_api_'+randomUUID().replaceAll('-','');
function client(name:string){const url=new URL(base!);url.pathname='/'+name;return new PrismaClient({datasources:{db:{url:url.toString()}}});}
let db:PrismaClient,ready=false,api:ApiV1Service,principal:ApiPrincipal,ownerId:string,variantId:string,fulfillment:FulfillmentService;
let sequence=0;

function partnerService(prismaClient: PrismaClient) {
  const prisma = prismaClient as never;
  const audit = new AuditService(prisma);
  const config = new ConfigService({ PAYMENT_MOCK: 'false' });
  const settings = new SettingsService(prisma, config, audit);
  const delivery = new FulfillmentService(prisma);
  const orders = new OrdersService(prisma, config, delivery, { createOrder: () => { throw new Error('external gateway forbidden'); } } as never, { isConfigured: false } as never, settings, new CouponsService(prisma, audit));
  const balance = new BalanceService(prisma, settings, delivery, new WalletCreditService(prisma));
  return { service: new ApiV1Service(prisma, new ApiKeysService(prisma, new ApiQuotaService(prisma)), orders, balance, delivery, settings), balance };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
beforeAll(async()=>{
 if(!base)return;
 const admin=client('postgres');try{await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);}finally{await admin.$disconnect();}
 db=client(database);
 const dir=resolve(__dirname,'../../prisma/migrations');
 for(const name of readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort())for(const statement of readFileSync(join(dir,name,'migration.sql'),'utf8').split(/\r?\n/).filter(l=>!l.trim().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
 const user=await db.user.create({data:{code:91919191,email:'partner@test.invalid',passwordHash:'synthetic',balance:100}});ownerId=user.id;
 await db.apiAccess.create({data:{userId:ownerId,enabled:true,approvedAt:new Date()}});
 const key=await db.apiKey.create({data:{ownerId,name:'fixture',prefix:'test',digest:'0'.repeat(64),scopes:[...API_SCOPES],expiresAt:new Date(Date.now()+3600000)}});
 principal={ownerId,keyId:key.id,scopes:[...API_SCOPES]};
 await db.storeSetup.create({data:{id:'main',maintenanceMode:false,publishedRevisionId:'fixture-published'}});
 await db.storeSetting.create({data:{id:'main',cryptoEnabled:true,bep20Address:'0x'+'1'.repeat(40),vndPerUsdt:26000}});
 const product=await db.product.create({data:{name:'Partner fixture',slug:'partner-fixture'}});
 const variant=await db.productVariant.create({data:{productId:product.id,name:'Default',price:5,priceAmount:5}});variantId=variant.id;
 await db.stockItem.createMany({data:Array.from({length:20},(_,i)=>({variantId,content:'PARTNER-FAKE-'+i}))});
 const prisma=db as never;const audit=new AuditService(prisma);const config=new ConfigService({PAYMENT_MOCK:'false'});const settings=new SettingsService(prisma,config,audit);fulfillment=new FulfillmentService(prisma);
 const orders=new OrdersService(prisma,config,fulfillment,{createOrder:()=>{throw new Error('external gateway forbidden');}} as never,{isConfigured:false} as never,settings,new CouponsService(prisma,audit));
 const balance=new BalanceService(prisma,settings,fulfillment,new WalletCreditService(prisma));
 const keys=new ApiKeysService(prisma,new ApiQuotaService(prisma));
 api=new ApiV1Service(prisma,keys,orders,balance,fulfillment,settings);ready=true;
},120000);
afterAll(async()=>{if(!db)return;await db.$disconnect();const admin=client('postgres');try{await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);}finally{await admin.$disconnect();}},60000);
function test(name:string,fn:()=>Promise<void>){it(name,async ctx=>{if(!ready)return ctx.skip();await fn();},30000);}
const body=()=>({items:[{variantId,quantity:1}],maxTotalUsdt:'5.000000'});

describe('partner API atomic purchases and owner receipts',()=>{
 test('concurrent repeated purchase is one debit, one order and no goods in POST',async()=>{
  const before=await db.user.findUniqueOrThrow({where:{id:ownerId}});
  const results=await Promise.all(Array.from({length:4},()=>api.purchase(principal,body(),'purchase-repeat')));
  expect(new Set(results.map(r=>r.data.code)).size).toBe(1);expect(results.filter(r=>!r.replayed)).toHaveLength(1);
  expect(results.every(r=>r.data.items.every(i=>i.deliveredLines===undefined))).toBe(true);
  expect(await db.apiOperationReceipt.count({where:{idempotencyKey:'purchase-repeat'}})).toBe(1);
  expect(await db.balanceEntry.count({where:{refCode:results[0].data.code}})).toBe(1);
  expect((await db.user.findUniqueOrThrow({where:{id:ownerId}})).balance.toString()).toBe(before.balance.sub(5).toString());
  expect((await api.getOrder(ownerId,results[0].data.code)).items[0].deliveredLines).toHaveLength(1);
 });
 test('same key different request rejects without another debit',async()=>{
  await expect(api.purchase(principal,{items:[{variantId,quantity:2}]},'purchase-repeat')).rejects.toThrow('api.idempotency_conflict');
  expect(await db.apiOperationReceipt.count({where:{idempotencyKey:'purchase-repeat'}})).toBe(1);
 });
 test('rotated key replays while maintenance and prices changed',async()=>{
  const key=await db.apiKey.create({data:{ownerId,name:'rotated',prefix:'next',digest:'1'.repeat(64),scopes:[...API_SCOPES],expiresAt:new Date(Date.now()+3600000)}});
  await db.storeSetup.update({where:{id:'main'},data:{maintenanceMode:true}});await db.productVariant.update({where:{id:variantId},data:{price:9}});
  try{const result=await api.purchase({...principal,keyId:key.id},body(),'purchase-repeat');expect(result.replayed).toBe(true);expect(result.data.totalAmount).toBe('5.000000');}
  finally{await db.storeSetup.update({where:{id:'main'},data:{maintenanceMode:false}});await db.productVariant.update({where:{id:variantId},data:{price:5}});}
 });
 test('insufficient stock or spending cap rollback receipt and money',async()=>{
  const before=await db.user.findUniqueOrThrow({where:{id:ownerId}});const count=await db.order.count();
  await expect(api.purchase(principal,{items:[{variantId,quantity:100}]},'no-stock-test')).rejects.toThrow();
  await expect(api.purchase(principal,{...body(),maxTotalUsdt:'4'},'price-cap-test')).rejects.toThrow();
  expect(await db.order.count()).toBe(count);expect(await db.apiOperationReceipt.count({where:{idempotencyKey:{in:['no-stock-test','price-cap-test']}}})).toBe(0);
  expect((await db.user.findUniqueOrThrow({where:{id:ownerId}})).balance.toString()).toBe(before.balance.toString());
 });
 test('delivery crash after commit is PAID and retry returns same purchase',async()=>{
  const original=fulfillment.deliverOrder.bind(fulfillment);fulfillment.deliverOrder=async()=>{throw new Error('simulated delivery outage');};
  let code='';try{const result=await api.purchase(principal,body(),'delivery-crash');code=result.data.code;expect(result.data.status).toBe('PAID');}finally{fulfillment.deliverOrder=original;}
  const result=await api.purchase(principal,body(),'delivery-crash');expect(result.replayed).toBe(true);expect(result.data.code).toBe(code);expect(await db.balanceEntry.count({where:{refCode:code}})).toBe(1);
 });
 test('idempotent deposit creates one code and still replays after method disabled',async()=>{
  const input={method:'crypto_bep20' as const,vndAmount:26000};
  const rows=await Promise.all([api.createDeposit(principal,input,'deposit-repeat'),api.createDeposit(principal,input,'deposit-repeat')]);
  expect(rows[0].data.code).toBe(rows[1].data.code);expect(rows.filter(r=>!r.replayed)).toHaveLength(1);
  await db.storeSetting.update({where:{id:'main'},data:{cryptoEnabled:false}});
  try{expect((await api.createDeposit(principal,input,'deposit-repeat')).replayed).toBe(true);}finally{await db.storeSetting.update({where:{id:'main'},data:{cryptoEnabled:true}});}
 });
 test('owner boundaries reject order code belonging to another account or non-API order',async()=>{
  const order=await db.order.findFirstOrThrow({where:{apiReceipt:{isNot:null}}});
  await expect(api.getOrder('other-user',order.code)).rejects.toThrow();
  const legacy=await db.order.create({data:{userId:ownerId,code:'legacy-no-api',totalAmount:0}});await expect(api.getOrder(ownerId,legacy.code)).rejects.toThrow();
 });
 test('purchase completes with a single database connection without a root-client query inside tx', async () => {
  const url = new URL(base!);
  url.pathname = '/' + database;
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '2');
  const single = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
   const result = await partnerService(single).service.purchase(principal, body(), 'single-connection');
   expect(result.data.totalAmount).toBe('5.000000');
   expect(await db.balanceEntry.count({ where: { refCode: result.data.code } })).toBe(1);
  } finally { await single.$disconnect(); }
 });
 test('deposit snapshot holds payment settings stable until the receipt commits', async () => {
  const { service, balance } = partnerService(db);
  const reached = barrier(), proceed = barrier();
  const create = balance.createDepositInTransaction.bind(balance);
  balance.createDepositInTransaction = async (...args) => {
   reached.release();
   await proceed.promise;
   return create(...args);
  };
  const purchase = service.createDeposit(principal, { method: 'crypto_bep20', vndAmount: 52000 }, 'settings-snapshot');
  await reached.promise;
  let changed = false;
  const change = db.storeSetting.update({ where: { id: 'main' }, data: { cryptoEnabled: false } }).then(() => { changed = true; });
  try {
   // Quan sát khóa thật, không xem một khoảng sleep là bằng chứng race đã xảy ra.
   const deadline = Date.now() + 3000;
   let blocked = false;
   while (!changed && Date.now() < deadline) {
    const rows = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%StoreSetting%') AS blocked`;
    if (rows[0].blocked) { blocked = true; break; }
   }
   expect(blocked).toBe(true);
   expect(changed).toBe(false);
  } finally {
   proceed.release();
   await Promise.allSettled([purchase, change]);
   await db.storeSetting.update({ where: { id: 'main' }, data: { cryptoEnabled: true } });
  }
  const result = await purchase;
  expect(result.data.instructions.address).toBe('0x' + '1'.repeat(40));
  expect(await db.apiOperationReceipt.count({ where: { idempotencyKey: 'settings-snapshot' } })).toBe(1);
 });
 test('revoked API access rejects new request and replay',async()=>{
  await db.apiAccess.update({where:{userId:ownerId},data:{enabled:false}});
  try{await expect(api.purchase(principal,body(),'purchase-repeat')).rejects.toThrow();await expect(api.purchase(principal,body(),'denied-new')).rejects.toThrow();}
  finally{await db.apiAccess.update({where:{userId:ownerId},data:{enabled:true}});}
 });
});
