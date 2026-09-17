import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultStorefrontDocument } from '@webcatt/shared';
import { StorefrontRenderer } from '../components/storefront/storefront-renderer';
import { StorefrontProvider } from './storefront';

function render(editing: boolean) {
  const document = createDefaultStorefrontDocument();
  document.pages.home.blocks.unshift({ id: 'rich-preview', type: 'richText', props: { html: { vi: '<p><a href="/orders">Orders</a></p>', en: '', zh: '' } } });
  return renderToStaticMarkup(createElement(StorefrontProvider, { config: { document, revision: 1, maintenanceMode: false, published: true }, children: createElement(StorefrontRenderer, { document, page: 'home', locale: 'vi', ...(editing ? { onSelect: () => {} } : {}) }) }));
}

describe('builder renderer interaction boundary', () => {
  it('keeps editable rich text inert so its links do not navigate away from unsaved work', () => {
    const html = render(true);
    expect(html).toContain('inert=""');
    expect(html).toContain('href="/orders"');
  });
  it('does not make published storefront content inert', () => {
    expect(render(false)).not.toContain('inert=""');
  });
});
