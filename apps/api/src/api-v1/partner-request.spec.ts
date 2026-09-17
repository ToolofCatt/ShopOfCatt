import 'reflect-metadata';
import { describe,it,expect } from 'vitest';
import { type ArgumentMetadata, type ArgumentsHost, type PipeTransform } from '@nestjs/common';
import { ApplicationValidationPipe } from '../common/application-validation.pipe';
import { PIPES_METADATA } from '@nestjs/common/constants';
import { ApiV1Controller } from './api-v1.controller';
import { ApiV1ExceptionFilter } from './api-v1.filter';
import { PartnerPageDto } from './partner-request';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PartnerOrderInputDto,PartnerDepositInputDto,canonicalOrder,canonicalDeposit,requestHash,requireIdempotencyKey } from './partner-request';

describe('partner request normalization',()=>{
 it('normalizes ordering, merged quantities and money without accepting client prices',()=>{
  const a=canonicalOrder({items:[{variantId:'b',quantity:1},{variantId:'a',quantity:1},{variantId:'b',quantity:2}],couponCode:' test ',maxTotalUsdt:'5.000000'});
  const b=canonicalOrder({items:[{variantId:'a',quantity:1},{variantId:'b',quantity:3}],couponCode:'TEST',maxTotalUsdt:'5'});
  expect(a).toEqual(b);expect(requestHash(a)).toBe(requestHash(b));
 });
 it('request amount or quantity differences change the fingerprint',()=>{
  const a=canonicalOrder({items:[{variantId:'a',quantity:1}]});
  expect(requestHash(a)).not.toBe(requestHash(canonicalOrder({items:[{variantId:'a',quantity:2}]})));
 });
 it.each(['','short','a b not-valid','x'.repeat(129)])('rejects invalid idempotency key %s',value=>expect(()=>requireIdempotencyKey(value)).toThrow());
 it('accepts bounded idempotency keys',()=>expect(requireIdempotencyKey('purchase:test-0001')).toBe('purchase:test-0001'));
 it('limits total units even when each line is valid',()=>expect(()=>canonicalOrder({items:[{variantId:'a',quantity:90},{variantId:'b',quantity:20}]})).toThrow());
 it('topup fingerprints preserve method and VND amount',()=>expect(canonicalDeposit({method:'sepay',vndAmount:10000})).toEqual({method:'sepay',vndAmount:10000}));
 it('validates no prices or owner ids in purchase payload',async()=>{
  const dto=plainToInstance(PartnerOrderInputDto,{items:[{variantId:'a',quantity:1}],userId:'other',price:1});
  expect((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
 it.each([{method:'mock',vndAmount:10000},{method:'sepay',vndAmount:9999},{method:'sepay',vndAmount:10000.5}])('rejects invalid topup %j',async input=>expect((await validate(plainToInstance(PartnerDepositInputDto,input))).length).toBeGreaterThan(0));
});

// Phải giữ thứ tự global → controller như bootstrap thật: validate DTO riêng đã
// bỏ lọt việc global whitelist xóa nhầm trần chi tiêu trước pipe strict của v1.
async function partnerPipeline(input: unknown, metatype: ArgumentMetadata['metatype'] = PartnerOrderInputDto) {
  const metadata: ArgumentMetadata = { type: metatype === PartnerPageDto ? 'query' : 'body', metatype };
  const pipes: PipeTransform[] = [
    new ApplicationValidationPipe(),
    ...(Reflect.getMetadata(PIPES_METADATA, ApiV1Controller) as PipeTransform[]),
  ];
  let enteredHandler = false;
  try {
    let value = input;
    for (const pipe of pipes) value = await pipe.transform(value, metadata);
    enteredHandler = true;
    if (metatype === PartnerOrderInputDto) canonicalOrder(value as PartnerOrderInputDto);
    return { status: 200, body: value, enteredHandler };
  } catch (error) {
    let status = 0;
    let body: unknown;
    const response = {
      setHeader: () => undefined,
      status: (value: number) => { status = value; return response; },
      json: (value: unknown) => { body = value; return response; },
    };
    new ApiV1ExceptionFilter().catch(error, {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'accept-language': 'en' } }), getResponse: () => response }),
    } as unknown as ArgumentsHost);
    return { status, body, enteredHandler };
  }
}

describe('partner HTTP validation pipeline', () => {
  it.each([
    { items: [{ variantId: 'a', quantity: 1 }], maxTotalUsd: '1.000000' },
    { items: [{ variantId: 'a', quantity: 1, unitPrice: '0.000001' }] },
    { items: [{ variantId: 'a', quantity: 1 }], maxTotalUsdt: null },
    { items: [{ variantId: 'a', quantity: 1 }], couponCode: null },
  ])('rejects invalid purchase %j before handler with the v1 error envelope', async input => {
    expect(await partnerPipeline(input)).toMatchObject({
      status: 400, enteredHandler: false,
      body: { error: { code: 'INVALID_REQUEST', message: expect.any(String) }, requestId: expect.any(String) },
    });
  });

  it('rejects unknown deposit and pagination properties before the controller pipe can lose them', async () => {
    expect(await partnerPipeline({ method: 'sepay', vndAmount: 26000, userId: 'other' }, PartnerDepositInputDto)).toMatchObject({ status: 400, enteredHandler: false });
    expect(await partnerPipeline({ page: '1', pageSize: '100' }, PartnerPageDto)).toMatchObject({ status: 400, enteredHandler: false });
  });

  it('accepts an omitted or explicit valid spending cap and transforms valid paging', async () => {
    for (const input of [
      { items: [{ variantId: 'a', quantity: 1 }] },
      { items: [{ variantId: 'a', quantity: 1 }], maxTotalUsdt: '5.000000', couponCode: 'SALE' },
    ]) expect(await partnerPipeline(input)).toMatchObject({ status: 200, enteredHandler: true, body: input });
    expect(await partnerPipeline({ page: '2', limit: '10' }, PartnerPageDto)).toMatchObject({ status: 200, body: { page: 2, limit: 10 } });
    expect(await partnerPipeline({ method: 'sepay', vndAmount: 26000 }, PartnerDepositInputDto)).toMatchObject({ status: 200 });
  });

  it('preserves legacy web DTO stripping rather than making every route strict', async () => {
    const pipe = new ApplicationValidationPipe();
    const value = await pipe.transform({ items: [{ variantId: 'a', quantity: 1, unitPrice: 0 }], userId: 'other' }, { type: 'body', metatype: CreateOrderDto });
    expect(value).toEqual({ items: [{ variantId: 'a', quantity: 1 }] });
  });
});
