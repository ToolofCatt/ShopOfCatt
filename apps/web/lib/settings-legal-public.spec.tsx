import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegalPage from '../app/legal/[slug]/page';
import { settingsUxEn } from './i18n/dictionaries/settings-ux';
// Giữ wrapper API thật; chỉ thay ranh giới mạng để không gọi máy chủ.
vi.mock('@/lib/i18n/server', () => ({ getServerDictionary: async () => ({ locale: 'en', t: { legal: { termsTitle: 'Terms', refundTitle: 'Refund', privacyTitle: 'Privacy', emptyTitle: 'No policy yet', emptyHint: 'Contact the store', updatedAt: 'Updated' }, common: { retry: 'Retry' }, settingsUx: settingsUxEn } }) }));

describe('public policy availability', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reports fetch failure with a retry link, never as a missing policy', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const html = renderToStaticMarkup(await LegalPage({ params: Promise.resolve({ slug: 'terms' }) }));
    expect(html).toContain(settingsUxEn.legalFetchError);
    expect(html).not.toContain('No policy yet');
    expect(html).toContain('href="/legal/terms"');
  });
  it('shows genuinely empty policy without inventing its content', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ slug: 'terms', title: '', body: '<p>&nbsp;</p>', updatedAt: new Date(0).toISOString() }));
    const html = renderToStaticMarkup(await LegalPage({ params: Promise.resolve({ slug: 'terms' }) }));
    expect(html).toContain('No policy yet');
    expect(html).not.toContain(settingsUxEn.legalFetchError);
    expect(html).not.toContain('wc-prose');
  });
});
