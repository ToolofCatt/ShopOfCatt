import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { mailPriceQuote } from './mail-price';

const setting = { multiplier: new Prisma.Decimal(2), vndRounding: 1000 };
const offer = { cost: new Prisma.Decimal('0.02'), salePrice: null };
describe('mail VND rounding', () => {
  it.each([['1', '1000'], ['499', '1000'], ['500', '1000'], ['900', '1000'], ['1000', '1000'], ['1400', '1000'], ['1499', '1000'], ['1500', '2000'], ['1600', '2000'], ['2499', '2000'], ['2500', '3000']])('rounds VND %s to %s with half-up ties and a positive minimum', (amount, expected) => {
    const quote = mailPriceQuote({ ...offer, saleCurrency: 'VND', saleAmount: new Prisma.Decimal(amount) }, setting, 26000);
    expect(quote.amount.toString()).toBe(expected); expect(quote.currency).toBe('VND');
    expect(quote.price.toString()).toBe(new Prisma.Decimal(expected).div(26000).toDecimalPlaces(6, Prisma.Decimal.ROUND_FLOOR).toString());
  });
  it('rounds multiplier prices after converting to VND, using the same wallet quote', () => {
    const quote = mailPriceQuote(offer, setting, 26000);
    expect(quote.amount.toString()).toBe('1000'); expect(quote.currency).toBe('VND'); expect(quote.price.toString()).toBe('0.038461');
  });
  it('preserves explicit USDT prices and the unrounded stored VND anchor when switched off', () => {
    const usdt = mailPriceQuote({ ...offer, salePrice: new Prisma.Decimal('0.15') }, setting, 26000);
    expect(usdt.price.toString()).toBe('0.15'); expect(usdt.currency).toBe('USDT');
    const vnd = mailPriceQuote({ ...offer, saleCurrency: 'VND', saleAmount: new Prisma.Decimal('1400') }, { ...setting, vndRounding: 0 }, 26000);
    expect(vnd.amount.toString()).toBe('1400');
    expect(mailPriceQuote(offer, { ...setting, vndRounding: 0 }, 26000).price.toString()).toBe('0.04');
  });
  it('fails closed without a VND rate, and zero never becomes a charge', () => {
    expect(mailPriceQuote(offer, setting, 0).ready).toBe(false);
    const zero = mailPriceQuote({ ...offer, cost: new Prisma.Decimal(0) }, setting, 26000);
    expect(zero.ready).toBe(false); expect(zero.amount.toString()).toBe('0');
  });
});
