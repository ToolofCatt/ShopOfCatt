import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiDocs } from './api-docs';
import { partnerUxEn } from '../lib/i18n/dictionaries/partner-ux';

describe('public API documentation contract rendering', () => {
  it('renders versioned endpoints, separate order scopes, schemas and public OpenAPI download', () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { copy: partnerUxEn, baseUrl: 'https://shop.example/api/v1' }));
    for (const path of ['/api/v1/products', '/api/v1/products/{slug}', '/api/v1/wallet', '/api/v1/deposit-methods', '/api/v1/deposits', '/api/v1/deposits/{code}', '/api/v1/orders', '/api/v1/orders/{code}']) expect(html).toContain(path);
    expect(html).toContain('href="https://shop.example/api/v1/openapi.json"');
    expect(html).toContain('orders:read');
    expect(html).toContain('orders:write');
    expect(html).toContain('Idempotency-Key');
    expect(html).toContain('deliveredLines');
    expect(html).toContain('maxPending');
    expect(html).toContain('readPerKeyPerMinute');
  });
  it('provides env-based static samples without credential fields or request execution', () => {
    const html = renderToStaticMarkup(createElement(ApiDocs, { copy: partnerUxEn, baseUrl: 'https://shop.example/api/v1' }));
    expect(html).toContain('CATT_API_KEY');
    expect(html).toContain('urllib.request');
    expect(html).toContain('process.env.CATT_API_KEY');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('Try it');
    expect(html).toContain('href="/account/api"');
  });
});
