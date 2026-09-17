import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AdminService } from './admin.service';
import { ReconciliationQueryDto, reconciliationWhere, transferToReconciliationDto } from './dto/reconciliation-query.dto';

async function errors(input: Record<string, unknown>) {
  return validate(plainToInstance(ReconciliationQueryDto, input));
}

describe('reconciliation query and safe projection', () => {
  it('paginates beyond the legacy 100 rows and computes totals without changing the filter', async () => {
    const queries: unknown[]=[];
    const prisma={incomingTransfer:{
      findMany:async (q:{skip:number;take:number;where:unknown})=>{queries.push(q);return Array.from({length:q.take},(_,i)=>({id:`t${q.skip+i}`,source:'SEPAY',reference:`r${q.skip+i}`,amount:new Prisma.Decimal('1.000001'),currency:'VND',network:null,receiver:'r',status:'REVIEW',reviewReason:null,receivedAt:null,createdAt:new Date(0),payment:null,deposit:null}));},
      count:async(q:unknown)=>{queries.push(q);return 145;},
    }};
    const service=new AdminService(prisma as never,{} as never,{} as never,{} as never,{} as never);
    const result=await (service as unknown as {listReconciliation(q:ReconciliationQueryDto):Promise<{items:{id:string}[];total:number}>}).listReconciliation(plainToInstance(ReconciliationQueryDto,{page:'6',limit:'20',source:'SEPAY'}));
    expect(result.items[0].id).toBe('t100');
    expect(result.items).toHaveLength(20);
    expect(result.total).toBe(145);
    expect(queries).toEqual(expect.arrayContaining([expect.objectContaining({skip:100,take:20,where:{source:'SEPAY',status:{in:['OBSERVED','REVIEW']}}}),{where:{source:'SEPAY',status:{in:['OBSERVED','REVIEW']}}}]));
  });
  it.each([{page:'0'},{page:'1.5'},{limit:'101'},{limit:'-1'},{source:'OTHER'},{status:'DONE'},{amount:'NaN'},{amount:'1e3'},{amount:'1.1234567'},{currency:'BTC'},{q:'x'.repeat(201)}])('rejects malformed filters %j', async (input) => {
    expect((await errors(input)).length).toBeGreaterThan(0);
  });
  it('validates paged exact six-decimal amount without float conversion', async () => {
    const dto=plainToInstance(ReconciliationQueryDto,{page:'2',limit:'20',amount:'123.000001',currency:'USDT',status:'REVIEW',source:'CRYPTO:BEP20',q:'tx-id'});
    expect(await validate(dto)).toEqual([]);
    expect(dto.page).toBe(2);
    const where=reconciliationWhere(dto);
    expect(where.amount).toEqual(new Prisma.Decimal('123.000001'));
    expect(where.currency).toBe('USDT');
    expect(where.status).toBe('REVIEW');
    expect(where.source).toBe('CRYPTO:BEP20');
    expect(where.OR).toEqual([{id:{contains:'tx-id',mode:'insensitive'}},{reference:{contains:'tx-id',mode:'insensitive'}}]);
  });
  it('defaults to unresolved but allows conflicts on claimed transfers', () => {
    expect(reconciliationWhere(new ReconciliationQueryDto()).status).toEqual({in:['OBSERVED','REVIEW']});
    expect(reconciliationWhere(plainToInstance(ReconciliationQueryDto,{status:'ALL',conflicts:'true'}))).toMatchObject({reviewReason:'provider-facts-changed'});
    expect(reconciliationWhere(plainToInstance(ReconciliationQueryDto,{status:'ALL'})).status).toBeUndefined();
  });
  it('projects explicit public fields and keeps exact money, not provider/private payload', () => {
    const value={id:'transfer1',source:'SEPAY',reference:'ref1',amount:new Prisma.Decimal('100000.000001'),currency:'VND',network:null,receiver:'account',status:'REVIEW',reviewReason:'wrong-receiver',receivedAt:new Date('2026-01-01T00:00:00Z'),createdAt:new Date('2026-01-01T00:01:00Z'),payment:{order:{code:'DH-TEST'}},deposit:null,rawWebhook:{secret:'no'},privateKey:'no'};
    expect(transferToReconciliationDto(value)).toEqual({id:'transfer1',source:'SEPAY',reference:'ref1',amount:'100000.000001',currency:'VND',network:null,receiver:'account',status:'REVIEW',reviewReason:'wrong-receiver',receivedAt:'2026-01-01T00:00:00.000Z',createdAt:'2026-01-01T00:01:00.000Z',orderCode:'DH-TEST',depositCode:null,resolvable:true});
  });
  it.each(['CLAIMED','REVIEW'])('provider facts conflict is not offered for settlement even when status=%s', (status) => {
    const row=transferToReconciliationDto({id:'t',source:'SEPAY',reference:'r',amount:new Prisma.Decimal(5),currency:'VND',network:null,receiver:null,status,reviewReason:'provider-facts-changed',receivedAt:null,createdAt:new Date(0),payment:null,deposit:null});
    expect(row.resolvable).toBe(false);
  });
});
