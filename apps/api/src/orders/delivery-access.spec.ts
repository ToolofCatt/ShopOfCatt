import { describe, it, expect, vi, afterEach } from 'vitest';
import { DeliveryAccessService } from './delivery-access.service';

function fixture() {
 const user={id:'buyer',lockedAt:null,passwordChangedAt:null};
 const detail={code:'DH-ABC123',status:'DELIVERED',items:[{productName:'Fixture',variantName:'One',deliveredLines:['original|secret']}],payment:{cryptoTxId:'not-public'}};
 const orders={getOwnDetail:vi.fn(async(id,code)=>{if(id!=='buyer'||code!=='DH-ABC123')throw new Error('wrong owner');return detail;})};
 const service=new DeliveryAccessService({get:(key:string)=>key==='JWT_SECRET'?'fixture-signing-secret':'https://shop.example.test'} as any,{user:{findUnique:async()=>user}} as any,orders as any);
 return {service,user,detail,orders};
}
afterEach(()=>vi.useRealTimers());
describe('read-only delivery link',()=>{
 it('opens only the signed order and returns delivery fields, not payment or account data',async()=>{
  const f=fixture();const url=await f.service.createLink('buyer','DH-ABC123');
  expect(new URL(url).pathname).toBe('/delivery');expect(new URL(url).search).toBe('');
  const token=new URL(url).hash.slice(1);
  const result=await f.service.read(token);
  expect(result.code).toBe('DH-ABC123');expect(result.items[0].lines).toEqual(['original|secret']);
  expect(result).not.toHaveProperty('payment');expect(result).not.toHaveProperty('userId');
  await expect(f.service.read(token.slice(0,-5)+'xxxxx')).rejects.toThrow();
  const [payload,signature]=token.split('.');const forged=JSON.parse(Buffer.from(payload,'base64url').toString());forged.c='DH-OTHER';
  await expect(f.service.read(Buffer.from(JSON.stringify(forged)).toString('base64url')+'.'+signature)).rejects.toThrow();
 });
 it('expires after 15 minutes and rejects ordinary login tokens',async()=>{
  vi.useFakeTimers();const f=fixture();const url=await f.service.createLink('buyer','DH-ABC123');
  vi.advanceTimersByTime(16*60_000);await expect(f.service.read(new URL(url).hash.slice(1))).rejects.toThrow();
  await expect(f.service.read('eyJhbGciOiJIUzI1NiJ9.body.signature')).rejects.toThrow();
 });
 it('rechecks locked users and delivered status',async()=>{
  const f=fixture();const url=await f.service.createLink('buyer','DH-ABC123');
  (f.user as any).lockedAt=new Date();await expect(f.service.read(new URL(url).hash.slice(1))).rejects.toThrow();
  (f.user as any).lockedAt=null;f.detail.status='PENDING';await expect(f.service.createLink('buyer','DH-ABC123')).rejects.toThrow();
 });
});
