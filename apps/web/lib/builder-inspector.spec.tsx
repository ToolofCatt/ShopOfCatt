import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StorefrontBlock } from '@webcatt/shared';
import { BuilderBlockInspector, BuilderThemeInspector } from './builder-inspector';
import { createDefaultStorefrontDocument } from '@webcatt/shared';
import { PreviewI18nProvider } from './i18n/client';

function render(block: StorefrontBlock) {
  return renderToStaticMarkup(createElement(PreviewI18nProvider, { locale: 'en', children: createElement(BuilderBlockInspector, {
    block, locale: 'vi', media: [], onChange: () => {}, onDelete: () => {}, onUpload: () => {},
  }) }));
}

describe('builder inspector accessible fields', () => {
  it('renders the heading value from text and associates labels with its controls', () => {
    const html = render({ id: 'heading-test', type: 'heading', props: { text: { vi: 'Nội dung đang sửa', en: 'English', zh: '中文' }, level: 2 } });
    expect(html).toContain('value="Nội dung đang sửa"');
    expect(html).toContain('for="builder-block-heading-test-text"');
    expect(html).toContain('id="builder-block-heading-test-text"');
    expect(html).toContain('for="builder-block-heading-test-level"');
    expect(html).toContain('id="builder-block-heading-test-level"');
    expect(html).not.toContain('<textarea');
  });

  it('labels the image select and keyboard-reachable upload control', () => {
    const html = render({ id: 'image-test', type: 'image', props: { alt: { vi: '', en: '', zh: '' } } });
    expect(html).toContain('for="builder-block-image-test-media"');
    expect(html).toContain('id="builder-block-image-test-media"');
    expect(html).toContain('for="builder-block-image-test-upload"');
    expect(html).toContain('id="builder-block-image-test-upload"');
    expect(html).toContain('type="file"');
    expect(html).not.toContain('class="hidden"');
  });

  it('associates theme range, select and file controls with visible labels', () => {
    const html = renderToStaticMarkup(createElement(PreviewI18nProvider, { locale: 'en', children: createElement(BuilderThemeInspector, {
      document: createDefaultStorefrontDocument(), locale: 'zh', media: [], mutate: () => {}, onUpload: () => {},
    }) }));
    for (const id of ['builder-store-name', 'builder-short-name', 'builder-tagline', 'builder-preset', 'builder-heading-font', 'builder-body-font', 'builder-radius', 'builder-width', 'builder-density', 'builder-logo-upload', 'builder-logo-media', 'builder-favicon-upload', 'builder-favicon-media']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('does not offer deletion of a layout containing a required business block', () => {
    const html = render({ id: 'layout-main', type: 'section', props: {}, children: [{ id: 'nested-products', type: 'productBrowser', props: {} }] });
    expect(html).toContain('Business logic locked');
    expect(html).not.toContain('Delete block');
  });

  it('keeps required business blocks locked and does not offer a delete button', () => {
    const html = render({ id: 'product-main', type: 'productDetail', props: {} });
    expect(html).toContain('Business logic locked');
    expect(html).not.toContain('Delete block');
  });
});
