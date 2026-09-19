import { describe, it, expect } from 'vitest';
import { previewPaymentDiscount } from './payment-discount';
describe('payment discount display precision',()=>{
 it('matches decimal money at six places',()=>{
  expect(previewPaymentDiscount(10,10)).toEqual({discount:1,total:9});
  expect(previewPaymentDiscount(8,10)).toEqual({discount:0.8,total:7.2});
  expect(previewPaymentDiscount(0.000001,99)).toEqual({discount:0,total:0.000001});
  expect(previewPaymentDiscount(1.234567,12.5)).toEqual({discount:0.15432,total:1.080247});
 });
 it('rejects invalid amounts and percentages',()=>{
  expect(()=>previewPaymentDiscount(1,100)).toThrow();expect(()=>previewPaymentDiscount(-1,10)).toThrow();
 });
});
