import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { vi as dictionary } from '../../lib/i18n/dictionaries/vi';
import { adminUxEn } from '../../lib/i18n/dictionaries/admin-ux';
import { AdminSidebar } from './sidebar';

const route = vi.hoisted(() => ({ pathname: '/admin/products/item-1' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/lib/i18n/client', () => ({
  useI18n: () => ({
    t: {
      ...dictionary,
      adminUx: adminUxEn,
    },
  }),
}));
vi.mock('@/lib/storefront', () => ({
  useStorefront: () => ({
    document: { brand: { logoAssetId: null } },
    mediaUrl: () => null,
  }),
}));
vi.mock('@/lib/cn', async () => import('../../lib/cn'));

// Chỉ giả lập router/context; HTML được tạo từ Sidebar thật, không đọc source.
function renderSidebar(pathname = '/admin/products/item-1') {
  route.pathname = pathname;
  return renderToStaticMarkup(createElement(AdminSidebar));
}

function linksTo(html: string, href: string) {
  return html.split('<a ').slice(1).map((part) => part.split('</a>')[0])
    .filter((part) => part.includes(`href="${href}"`));
}

describe('admin navigation accessibility', () => {
  it('marks the matching section current in both desktop and mobile navigation', () => {
    const html = renderSidebar();
    const productLinks = linksTo(html, '/admin/products');
    expect(productLinks).toHaveLength(2);
    expect(productLinks.every((link) => link.includes('aria-current="page"'))).toBe(true);
    expect(linksTo(html, '/admin').every((link) => !link.includes('aria-current'))).toBe(true);
  });

  it('does not mark a similarly-prefixed unrelated section current', () => {
    const html = renderSidebar('/admin/products-archive');
    expect(linksTo(html, '/admin/products').every((link) => !link.includes('aria-current'))).toBe(true);
  });

  it('provides a named native dialog and a named expanded-state trigger', () => {
    const html = renderSidebar();
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Open admin menu');
    expect(html).toContain('Close admin menu');
    expect(html).toContain('aria-label="Admin navigation"');
    expect(html).toContain('aria-labelledby=');
  });

  it('exposes reconciliation and account routes with text in both navigation surfaces', () => {
    const html = renderSidebar('/admin/reconciliation');
    const reconciliationLinks = linksTo(html, '/admin/reconciliation');
    expect(reconciliationLinks).toHaveLength(2);
    expect(reconciliationLinks.every((link) => link.includes('Payment reconciliation'))).toBe(true);
    expect(reconciliationLinks.every((link) => link.includes('aria-current="page"'))).toBe(true);
    expect(linksTo(html, '/account/password')).toHaveLength(2);
    expect(linksTo(html, '/')).toHaveLength(2);
  });
});
