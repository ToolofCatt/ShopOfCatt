import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDto } from '@webcatt/shared';
import { en } from './i18n/dictionaries/en';
import { StorefrontShell } from '../components/storefront/storefront-shell';
import { BuyBox, PurchaseChoices } from '../components/buy-box';
import { ProductDetail } from '../components/product-detail';

const state = vi.hoisted(() => ({ pathname: '/orders/ORDER-DEMO', paused: true }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push() {}, replace() {} }) }));
vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: en, locale: 'en' }) }));
vi.mock('@/lib/storefront', () => ({ useStorefront: () => ({ published: true, maintenanceMode: state.paused, document: { brand: { name: 'Fixture store' } } }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, token: null, loading: false }) }));
vi.mock('@/lib/prices', () => ({ usePrices: () => ({ price: () => ({ primary: '$1' }), priceUsdt: () => ({ primary: '$1' }) }) }));

const product: ProductDto = {
  id: 'product-fixture', slug: 'demo-product', name: 'Demo', shortDescription: null, description: null,
  currency: 'USDT', minPrice: 1, maxPrice: 1, image: null, thumbnail: null, imageBytes: null,
  thumbnailBytes: null, images: [], category: null, sortOrder: 0, active: true, stockDrawMode: 'SEQUENTIAL',
  availableStock: 0, sold: 0, variants: [], createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => { state.paused = true; state.pathname = '/orders/ORDER-DEMO'; });

describe('purchase choice restoration boundary', () => {
  const controls = createElement('div', null,
    createElement('button', { type: 'button' }, 'Variant'),
    createElement('input', { name: 'quantity', defaultValue: '3' }),
    createElement('input', { name: 'coupon', defaultValue: 'SALE' }),
    createElement('button', { type: 'button' }, 'Payment method'),
  );
  it('locks native choice controls while preserving their visible values during restore', () => {
    const html = renderToStaticMarkup(createElement(PurchaseChoices, { restoring: true, children: controls }));
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('name="quantity" value="3"');
    expect(html).toContain('name="coupon" value="SALE"');
    expect(html).toContain('Payment method');
    expect(html).not.toContain('hidden');
  });
  it('releases the fieldset after restore settles without changing selections', () => {
    const html = renderToStaticMarkup(createElement(PurchaseChoices, { restoring: false, children: controls }));
    expect(html).toContain('<fieldset');
    expect(html).not.toContain('disabled=');
    expect(html).toContain('name="quantity" value="3"');
  });
});

describe('actual customer components under maintenance', () => {
  it('product preview marks purchase controls inert even when rendered without the builder wrapper', () => {
    state.paused = false;
    const html = renderToStaticMarkup(createElement(ProductDetail, { product, preview: true }));
    expect(html).toContain('inert=""');
    expect(html).not.toContain('Loading support channels');
  });
  it('keeps aftersales content and skip navigation without a second main landmark', () => {
    const html = renderToStaticMarkup(createElement(StorefrontShell, { children: createElement('p', null, 'Delivered fixture content'), announcement: null }));
    expect(html).toContain('Delivered fixture content');
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
    expect(html.split('<main').length - 1).toBe(1);
    expect(html).toContain('href="/orders"');
    expect(html).not.toContain('href="/products');
  });
  it('does not render shopping or mock payment children during maintenance', () => {
    for (const pathname of ['/products/demo', '/mock-pay/ORDER-DEMO']) {
      state.pathname = pathname;
      const html = renderToStaticMarkup(createElement(StorefrontShell, { children: createElement('button', null, 'Submit a new purchase'), announcement: null }));
      expect(html).not.toContain('Submit a new purchase');
      expect(html).toContain('New purchases are paused');
      expect(html).toContain('Store support');
    }
  });
  it('BuyBox shows support rather than a purchase action even when mounted directly', () => {
    const html = renderToStaticMarkup(createElement(BuyBox, { product }));
    expect(html).toContain('New purchases are paused');
    expect(html).not.toContain(en.product.buyNow);
    expect(html).not.toContain('id="buy-quantity"');
  });
  it('out-of-stock BuyBox offers support with the public product reference', () => {
    state.paused = false;
    const html = renderToStaticMarkup(createElement(BuyBox, { product }));
    expect(html).toContain('Ask the store about this product');
    expect(html).toContain('demo-product');
    expect(html).toContain('disabled=""');
  });
});
