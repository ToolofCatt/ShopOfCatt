import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreviewContent } from './preview-content';

// Chứng minh hợp đồng HTML với trình duyệt; SSR không mô phỏng Tab/Enter thật.
describe('preview content interaction boundary', () => {
  it('marks live controls inert without disabling or replacing their visual content', () => {
    const html = renderToStaticMarkup(createElement(PreviewContent, {
      children: createElement('button', { type: 'button', className: 'buy-box-button' }, 'Buy sample product'),
    }));
    expect(html).toContain('inert=""');
    expect(html).toContain('<button type="button" class="buy-box-button">Buy sample product</button>');
    expect(html).not.toContain('disabled=');
  });

  it('leaves pointer hit testing to the builder shell outside the inert subtree', () => {
    const html = renderToStaticMarkup(createElement(PreviewContent, {
      children: createElement('a', { href: '/products/example' }, 'Product preview'),
    }));
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('inert=""');
    expect(html).toContain('Product preview');
  });
});
