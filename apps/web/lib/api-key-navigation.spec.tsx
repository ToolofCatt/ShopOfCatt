import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { isCustomerAfterSalesPath } from './customer-navigation';
import { StorefrontShell } from '../components/storefront/storefront-shell';
import { createDefaultStorefrontDocument } from '@webcatt/shared';
import { en } from './i18n/dictionaries/en';
const state = vi.hoisted(() => ({ pathname: '/docs/api', paused: true }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push() {}, replace() {} }) }));
vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: en, locale: 'en' }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, loading: false, token: null }) }));
vi.mock('@/lib/storefront', () => ({ useStorefront: () => ({ published: true, maintenanceMode: state.paused, document: createDefaultStorefrontDocument(), mediaUrl: () => null }) }));

describe('partner route exemptions', () => {
  it('allows only the exact API docs route during maintenance', () => {
    expect(isCustomerAfterSalesPath('/docs/api')).toBe(true);
    for (const path of ['/docs', '/docs/api-other', '/docs/api/private', '/docs/apievil']) expect(isCustomerAfterSalesPath(path)).toBe(false);
    state.pathname = '/docs/api'; state.paused = true;
    const html = renderToStaticMarkup(createElement(StorefrontShell, { announcement: null, children: createElement('p', null, 'Public API documentation fixture') }));
    expect(html).toContain('Public API documentation fixture');
  });
  it('renders account API management outside the customizable account builder', () => {
    state.pathname = '/account/api'; state.paused = false;
    const html = renderToStaticMarkup(createElement(StorefrontShell, { announcement: null, children: createElement('p', null, 'API key management fixture') }));
    expect(html).toContain('API key management fixture');
    expect(html).not.toContain('data-storefront');
  });
});
