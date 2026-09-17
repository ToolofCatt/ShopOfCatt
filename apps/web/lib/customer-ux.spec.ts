import { describe, expect, it } from 'vitest';
import { safeCustomerNext, isCustomerAfterSalesPath } from './customer-navigation';
import { getCustomerDelivery } from './customer-order-state';
import { readPurchaseDraft, savePurchaseDraft, clearPurchaseDraft, revalidatePurchaseDraft } from './customer-purchase-draft';

// Các ca này bắt redirect ngoài site, thành công giả, draft cũ và lưu nhầm bí mật.
describe('customer navigation', () => {
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/\nevil.test', 'javascript:alert(1)'])('rejects unsafe next %s', (value) => {
    expect(safeCustomerNext(value)).toBe('/');
  });
  it('retains an internal product destination and query', () => {
    expect(safeCustomerNext('/products/demo?variant=one')).toBe('/products/demo?variant=one');
  });
  it.each(['/orders', '/orders/order-1', '/checkout/order-1', '/account', '/account/password', '/login', '/legal/refund'])('keeps aftersales route %s available', (path) => {
    expect(isCustomerAfterSalesPath(path)).toBe(true);
  });
  it.each(['/', '/products/demo', '/mock-pay/order-1', '/orders-fake', '/accounting'])('blocks new shopping route %s during maintenance', (path) => {
    expect(isCustomerAfterSalesPath(path)).toBe(false);
  });
});

describe('server-derived delivery', () => {
  it('does not treat a pending order with lines as a confirmed payment', () => {
    expect(getCustomerDelivery({ status: 'PENDING', items: [{ quantity: 2, deliveredLines: ['old'] }] })).toEqual({ kind: 'unconfirmed', delivered: 1, total: 2 });
  });
  it('distinguishes PAID without delivery from partial delivery', () => {
    expect(getCustomerDelivery({ status: 'PAID', items: [{ quantity: 2 }] })).toEqual({ kind: 'waiting', delivered: 0, total: 2 });
    expect(getCustomerDelivery({ status: 'PAID', items: [{ quantity: 2, deliveredLines: ['one'] }, { quantity: 1, deliveredLines: ['two'] }] })).toEqual({ kind: 'partial', delivered: 2, total: 3 });
  });
  it('uses every line quantity and retains the server distinction between PAID and DELIVERED', () => {
    expect(getCustomerDelivery({ status: 'PAID', items: [{ quantity: 1, deliveredLines: ['one'] }] }).kind).toBe('available');
    expect(getCustomerDelivery({ status: 'DELIVERED', items: [{ quantity: 1, deliveredLines: ['one'] }] }).kind).toBe('delivered');
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
}
const draft = { productId: 'product-1', variantId: 'variant-1', quantity: 3, coupon: 'SALE', method: 'sepay' as const };

describe('purchase selection draft', () => {
  it('roundtrips only whitelisted selections and removes the draft after success', () => {
    const storage = memoryStorage();
    savePurchaseDraft(() => storage, { ...draft, token: 'secret', price: 100 } as typeof draft, 1000);
    expect(readPurchaseDraft(() => storage, 'product-1', 1100)).toEqual({ ...draft, version: 1, savedAt: 1000 });
    expect([...storage.values.values()].join('')).not.toContain('secret');
    expect([...storage.values.values()].join('')).not.toContain('price');
    clearPurchaseDraft(() => storage, 'product-1');
    expect(readPurchaseDraft(() => storage, 'product-1', 1100)).toBeNull();
  });
  it('expires at 30 minutes without extending its life on read', () => {
    const storage = memoryStorage();
    savePurchaseDraft(() => storage, draft, 1000);
    expect(readPurchaseDraft(() => storage, 'product-1', 1800999)).not.toBeNull();
    expect(readPurchaseDraft(() => storage, 'product-1', 1801000)).toBeNull();
  });
  it('ignores corruption, incompatible versions and invalid quantities', () => {
    const storage = memoryStorage();
    savePurchaseDraft(() => storage, draft, 1000);
    const key = [...storage.values.keys()][0];
    for (const value of ['{', JSON.stringify({ ...draft, version: 2, savedAt: 1000 }), JSON.stringify({ ...draft, version: 1, savedAt: 1000, quantity: -1 })]) {
      storage.setItem(key, value);
      expect(readPurchaseDraft(() => storage, 'product-1', 1100)).toBeNull();
    }
  });
  it('survives a blocked storage accessor and throwing storage methods', () => {
    const blocked = () => { throw new Error('blocked'); };
    expect(savePurchaseDraft(blocked, draft, 1000)).toBe(false);
    expect(readPurchaseDraft(blocked, 'product-1', 1100)).toBeNull();
    expect(() => clearPurchaseDraft(blocked, 'product-1')).not.toThrow();
    const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
    expect(readPurchaseDraft(() => storage, 'product-1', 1100)).toBeNull();
  });
  it('revalidates stock and payment options without carrying price or submitting an order', () => {
    const result = revalidatePurchaseDraft(draft, [{ id: 'variant-1', active: true, availableStock: 1 }], ['crypto_bep20']);
    expect(result).toEqual({ variantId: 'variant-1', quantity: 1, coupon: 'SALE', method: 'crypto_bep20', changed: true });
  });
  it('falls back from a removed variant and never invents a payment option', () => {
    expect(revalidatePurchaseDraft(draft, [{ id: 'variant-2', active: true, availableStock: 2 }], [])).toEqual({ variantId: 'variant-2', quantity: 2, coupon: 'SALE', method: null, changed: true });
  });
});
