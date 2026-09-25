import { describe, expect, it } from 'vitest';
import type { AdminMailOfferDto } from '@webcatt/shared';
import { parseMailPriceInput, filterMailOffers, priceBucket } from './mail-price-editor';
describe('mail quick price editor', () => {
  it('accepts common VND shorthand but never turns a bad input into a charge', () => {
    for (const raw of ['3k', '3.000', '3,000', '3000']) expect(parseMailPriceInput(raw, 'VND')).toBe('3000');
    expect(parseMailPriceInput('3.5k', 'VND')).toBe('3500');
    for (const raw of ['', '-3k', '3.5', '0', '3e3', '0.000001k']) expect(parseMailPriceInput(raw, 'VND')).toBeNull();
    expect(parseMailPriceInput('0,15', 'USDT')).toBe('0.15');
    expect(parseMailPriceInput('3k', 'USDT')).toBeNull();
    expect(parseMailPriceInput('0.0000001', 'USDT')).toBeNull();
  });
  it('keeps exact price and currency buckets separate, composes filters', () => {
    const base: AdminMailOfferDto = { code: 'a', name: 'A', category: 'gmail-api', price: '0.12', priceCurrency: 'VND', priceAmount: '3000', purchasable: true, stock: 3, active: true, syncedAt: '', cost: '0.03', salePrice: null, saleCurrency: 'VND', saleAmount: '3000' };
    const rows = [base, { ...base, code: 'b', priceCurrency: 'USDT' as const, priceAmount: '3000' }, { ...base, code: 'c', stock: 0 }];
    expect(priceBucket(rows[0], 'sale')).not.toBe(priceBucket(rows[1], 'sale'));
    expect(filterMailOffers(rows, { query: '', category: '', active: 'on', stock: 'in', mode: '', price: 'VND:3000', priceField: 'sale' }).map(o => o.code)).toEqual(['a']);
  });
});
