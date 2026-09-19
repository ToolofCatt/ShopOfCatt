import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { OrdersService } from './orders.service';
import { FulfillmentService } from './fulfillment.service';
import { SettingsService } from '../settings/settings.service';
import { CouponsService } from '../coupons/coupons.service';
import { BalanceService } from '../balance/balance.service';
import { WalletCreditService } from '../balance/wallet-credit.service';
import { PaymentsService } from '../payments/payments.service';
import { reconcileCryptoTransfers } from '../common/reconcile-transfers';
import { lockFinancialArbitration } from '../common/financial-lock';

const database='webcatt_payment_discount_test';
function client(name:string){const url=new URL(process.env.DATABASE_URL??'postgresql://postgres:postgres@localhost:5433/webcatt');url.pathname='/'+name;return new PrismaClient({datasources:{db:{url:String(url)}}});}
let db:PrismaClient,orders:OrdersService,settings:SettingsService,balance:BalanceService,payments:PaymentsService;
let ready=false,sequence=0;
let gatewayFail=false;
const gatewayAmounts:number[]=[];
beforeAll(async()=>{
 const root=client('postgres');try{await root.$queryRaw`SELECT 1`;}catch{await root.$disconnect();return;}
 try{await root.$executeRawUnsafe(`CREATE DATABASE "${database}"`);}finally{await root.$disconnect();}
 db=client(database);
 const dir=resolve(__dirname,'../../prisma/migrations');
 for(const folder of readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort())for(const sql of readFileSync(join(dir,folder,'migration.sql'),'utf8').split(/\r?\n/).filter(l=>!l.trim().startsWith('--')).join('\n').split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(sql);
 const config={get:(key:string)=>({BINANCE_PAY_API_KEY:'fixture',PAYMENT_MOCK:'false',WEB_URL:'https://example.test'}[key])};
 settings=new SettingsService(db as any,config as any,{log:async()=>{}} as any);
 const fulfillment=new FulfillmentService(db as any);
 const coupons=new CouponsService(db as any,{log:async()=>{}} as any);
 const gateway={createOrder:async(input:any)=>{gatewayAmounts.push(input.orderAmount);if(gatewayFail)throw new Error('fixture gateway unavailable');return {prepayId:'fixture',checkoutUrl:'https://pay.binance.com/fixture'};}};
 orders=new OrdersService(db as any,config as any,fulfillment,gateway as any,{} as any,settings,coupons);
 balance=new BalanceService(db as any,settings,fulfillment,new WalletCreditService(db as any));
 payments=new PaymentsService(db as any,config as any,fulfillment,settings,balance);
 await db.storeSetting.create({data:{id:'main',binanceIdEnabled:true,binanceId:'12345',binancePayEnabled:true,cryptoEnabled:true,bep20Address:'0x'+'1'.repeat(40),vndPerUsdt:26000}});
 ready=true;
},120000);
afterAll(async()=>{if(!db)return;await db.$disconnect();const root=client('postgres');try{await root.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);}finally{await root.$disconnect();}});
function dbTest(name:string,run:()=>Promise<void>){it(name,async ctx=>{if(!ready)return ctx.skip();await run();},30000);}
async function create(couponCode?:string){
 const n=++sequence;const user=await db.user.create({data:{code:82000000+n,email:`discount-${n}@test.invalid`,passwordHash:'fixture',balance:100}});
 const product=await db.product.create({data:{slug:`discount-${n}`,name:'Fixture'}});
 const variant=await db.productVariant.create({data:{productId:product.id,name:'Fixture',price:10,priceAmount:10}});
 await db.stockItem.create({data:{variantId:variant.id,content:`FIXTURE-${n}`}});
 const result=await orders.create(user,{items:[{variantId:variant.id,quantity:1}],couponCode});
 return {user,order:result.order,variant};
}
async function configure(discounts:Record<string,number>){await settings.update({id:'fixture',email:'owner@test.invalid',code:1,role:'SUPERADMIN'} as any,{paymentDiscounts:discounts} as any);}

describe('payment method discounts, real PostgreSQL',()=>{
 dbTest('late crypto payment restores its exact issued discount and amount',async()=>{
  await configure({crypto_bep20:12.5});const a=await create();
  const selected=await orders.selectPayment(a.user.id,a.order.code,'crypto_bep20');expect(selected.totalAmount).toBe(8.75);
  await orders.selectPayment(a.user.id,a.order.code,'binance_id');
  const ids=await db.$transaction(async tx=>{await lockFinancialArbitration(tx);return reconcileCryptoTransfers(tx,[{txId:'fixture-discount-crypto',amount:8.75,network:'BSC',insertTimeMs:Date.now(),status:1}]);});
  expect(ids).toContain(a.order.id);
  const settled=await orders.getOwnDetail(a.user.id,a.order.code);expect(settled.totalAmount).toBe(8.75);expect(settled.payment?.cryptoAmount).toBe(8.75);
 });
 dbTest('concurrent method changes leave order and current payment amounts equal',async()=>{
  await configure({binance_pay:10,binance_id:15,crypto_bep20:20});const a=await create();
  await Promise.allSettled([orders.selectPayment(a.user.id,a.order.code,'binance_id'),orders.selectPayment(a.user.id,a.order.code,'crypto_bep20')]);
  const current=await db.order.findUniqueOrThrow({where:{id:a.order.id},include:{payment:true}});
  expect(current.totalAmount.equals(current.payment!.amount)).toBe(true);expect(current.totalAmount.equals(current.payment!.cryptoAmount!)).toBe(true);
  expect([8,8.5]).toContain(Number(current.totalAmount));
 });
 dbTest('10% Binance Pay is quoted at the gateway and persisted once; switching removes it',async()=>{
  await configure({binance_pay:10});
  const a=await create();expect(a.order.totalAmount).toBe(9);expect(gatewayAmounts.at(-1)).toBe(9);
  expect(a.order.discountAmount).toBe(1);
  const retry=await orders.selectPayment(a.user.id,a.order.code,'binance_pay');expect(retry.totalAmount).toBe(9);
  const changed=await orders.selectPayment(a.user.id,a.order.code,'binance_id');expect(changed.totalAmount).toBe(10);expect(changed.payment?.cryptoAmount).toBe(10);
 });
 dbTest('coupon first, then method discount; admin edits do not reprice an issued session',async()=>{
  await configure({binance_pay:10});
  await db.coupon.create({data:{code:'LESS20',type:'PERCENT',value:20}});
  const a=await create('LESS20');expect(a.order.totalAmount).toBe(7.2);expect(a.order.discountAmount).toBe(2.8);
  await configure({binance_pay:25});
  expect((await orders.getOwnDetail(a.user.id,a.order.code)).totalAmount).toBe(7.2);
  expect((await orders.selectPayment(a.user.id,a.order.code,'binance_pay')).totalAmount).toBe(7.2);
 });
 dbTest('a delayed successful merchant webhook restores its quoted price after switching method',async()=>{
  await configure({binance_pay:10});const a=await create();const old=a.order.payment!.merchantTradeNo;
  await orders.selectPayment(a.user.id,a.order.code,'binance_id');
  await payments.handleBinanceWebhook({bizStatus:'PAY_SUCCESS',data:JSON.stringify({merchantTradeNo:old})});
  const settled=await orders.getOwnDetail(a.user.id,a.order.code);expect(settled.totalAmount).toBe(9);expect(settled.status).toBe('DELIVERED');
  await payments.handleBinanceWebhook({bizStatus:'PAY_SUCCESS',data:JSON.stringify({merchantTradeNo:old})});
  expect(await db.stockItem.count({where:{variantId:a.variant.id,status:'SOLD'}})).toBe(1);
 });
 dbTest('balance cannot inherit a discount earned by choosing an external gateway',async()=>{
  await configure({binance_pay:10});const a=await create();await balance.payOrderWithBalance(a.user.id,a.order.code);
  expect(Number((await db.user.findUniqueOrThrow({where:{id:a.user.id}})).balance)).toBe(90);
  expect((await orders.getOwnDetail(a.user.id,a.order.code)).totalAmount).toBe(10);
 });
 dbTest('gateway failure preserves the current invoice and payment amount',async()=>{
  await configure({binance_pay:0});const a=await create();await orders.selectPayment(a.user.id,a.order.code,'binance_id');
  await configure({binance_pay:15});gatewayFail=true;
  try{await expect(orders.selectPayment(a.user.id,a.order.code,'binance_pay')).rejects.toThrow();}finally{gatewayFail=false;}
  const current=await orders.getOwnDetail(a.user.id,a.order.code);expect(current.totalAmount).toBe(10);expect(current.payment?.mode).toBe('BINANCE_ID');
 });
 dbTest('invalid discounts cannot be saved, 0 disables the offer',async()=>{
  for(const value of [-1,100,Infinity,0.001])await expect(configure({binance_pay:value})).rejects.toThrow();
  await expect(configure({mock:10})).rejects.toThrow();await expect(configure({bogus:10})).rejects.toThrow();
  await configure({binance_pay:0});expect((await create()).order.totalAmount).toBe(10);
 });
});
