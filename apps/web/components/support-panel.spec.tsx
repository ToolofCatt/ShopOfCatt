import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { customerUxEn } from '../lib/i18n/dictionaries/customer-ux';
import { SupportPanelContent } from './support-panel';

vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: { customerUx: customerUxEn, common: { retry: 'Retry', copied: 'Copied' } } }) }));

// HTML là output của component thật, không đọc source hoặc trích AST.
describe('support panel rendered states', () => {
  it('distinguishes network failure with retry from unconfigured support', () => {
    const error = renderToStaticMarkup(createElement(SupportPanelContent, { info: null, state: 'error', onRetry: () => {} }));
    const empty = renderToStaticMarkup(createElement(SupportPanelContent, { info: { supportChannels: [], supportNote: '' }, state: 'ready', onRetry: () => {} }));
    expect(error).toContain('Support channels could not be loaded');
    expect(error).toContain('Retry');
    expect(empty).toContain('has not configured a support channel');
    expect(empty).not.toContain('Support channels could not be loaded');
  });
  it('shows only a reference for copying and never appends it to external support URLs', () => {
    const html = renderToStaticMarkup(createElement(SupportPanelContent, { info: { supportChannels: [{ label: 'Support', value: '@store', url: 'https://example.test/support' }], supportNote: '' }, state: 'ready', reference: 'ORDER-DEMO', onRetry: () => {} }));
    expect(html).toContain('ORDER-DEMO');
    expect(html).toContain('Copy reference');
    expect(html).toContain('href="https://example.test/support"');
    expect(html).not.toContain('support?');
    expect(html).toContain('href="/legal/refund"');
  });
  it('does not make an unsafe support URL clickable', () => {
    const html = renderToStaticMarkup(createElement(SupportPanelContent, { info: { supportChannels: [{ label: 'Support', value: 'contact', url: 'javascript:alert(1)' }], supportNote: '' }, state: 'ready', onRetry: () => {} }));
    expect(html).toContain('contact');
    expect(html).not.toContain('javascript:');
  });
});
