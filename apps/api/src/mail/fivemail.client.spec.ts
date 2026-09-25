import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiveMailClient } from './fivemail.client';
afterEach(()=>vi.unstubAllGlobals());
describe('5Mail transport',()=>{
 it('validates catalog data and preserves exact decimal prices',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:0,data:[{name:'Telegram',code:'g_api_telegram',price:0.033,stock:2943}]}))));
  const client=new FiveMailClient();expect(await client.list('fixture-secret','gmail-api')).toEqual([{name:'Telegram',code:'g_api_telegram',price:'0.033',stock:2943}]);
 });
 it('never exposes provider URL/token or retries an ambiguous purchase',async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error('https://shop.5mail.io/shop/buy?token=fixture-secret'));vi.stubGlobal('fetch',fetch);
  await expect(new FiveMailClient().buy('fixture-secret','code',2)).rejects.toThrow('mail.provider_unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('rejects partial delivery and disables redirects',async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({code:0,data:{orderNo:'S1',productCode:'code',totalPrice:0.04,details:[{text:'mail----url'}]}})));vi.stubGlobal('fetch',fetch);
  await expect(new FiveMailClient().buy('fixture','code',2)).rejects.toThrow();
  expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
 });
 it('requires API success and known categories before network calls',async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({code:5,message:'fixture-secret'})));vi.stubGlobal('fetch',fetch);
  await expect(new FiveMailClient().list('fixture','gmail-api')).rejects.toThrow('mail.provider_unavailable');
  await expect(new FiveMailClient().list('fixture','other' as any)).rejects.toThrow('mail.invalid');
 });
});
