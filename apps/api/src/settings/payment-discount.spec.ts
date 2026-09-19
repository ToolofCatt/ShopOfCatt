import { describe, it, expect } from 'vitest';
import { SettingsService } from './settings.service';

describe('payment discount visibility',()=>{
 it('publishes configured 10% with the enabled method',async()=>{
  const service=new SettingsService({} as any,{get:()=> 'fixture'} as any,{} as any);
  const snapshot={binancePayEnabled:true,binanceIdEnabled:false,binanceId:'',binanceQr:'',cryptoEnabled:false,bep20Address:'',trc20Address:'',sepayEnabled:false,mockEnabled:false,paymentDiscounts:{binance_pay:10}};
  expect(await service.getEnabledMethods(snapshot as any)).toContainEqual({method:'binance_pay',discountPercent:10});
 });
});
