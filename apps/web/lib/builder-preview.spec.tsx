import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as i18n from './i18n/client';
import { getDictionary } from './i18n';

vi.mock('next/navigation', () => ({ useRouter: () => { throw new Error('Preview must not use the router'); } }));
afterEach(() => vi.unstubAllGlobals());

describe('builder read-only content locale', () => {
  it('exposes preview text in the content locale without cookie or router writes', () => {
    expect(i18n).toHaveProperty('PreviewI18nProvider');
    vi.stubGlobal('document', { set cookie(_value: string) { throw new Error('Preview must not write cookies'); } });
    function Probe() {
      const { t, locale, setLocale } = i18n.useI18n();
      setLocale('vi');
      return createElement('span', { lang: locale }, t.product.breadcrumbHome);
    }
    const html = renderToStaticMarkup(createElement(i18n.PreviewI18nProvider, { locale: 'en', children: createElement(Probe) }));
    expect(html).toContain('lang="en"');
    expect(html).toContain(getDictionary('en').product.breadcrumbHome);
  });

  it('keeps an outer admin dictionary separate from nested preview content', () => {
    expect(i18n).toHaveProperty('PreviewI18nProvider');
    function Probe() { const { locale } = i18n.useI18n(); return createElement('span', null, locale); }
    const html = renderToStaticMarkup(createElement(i18n.PreviewI18nProvider, { locale: 'vi', children: [
      createElement(Probe, { key: 'before' }),
      createElement(i18n.PreviewI18nProvider, { key: 'preview', locale: 'zh', children: createElement(Probe) }),
      createElement(Probe, { key: 'after' }),
    ] }));
    expect(html).toBe('<span>vi</span><span>zh</span><span>vi</span>');
  });
});
