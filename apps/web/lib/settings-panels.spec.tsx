import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from '../components/admin/tabs';

vi.mock('@/lib/cn', () => ({ cn: (...values: unknown[]) => values.filter(Boolean).join(' ') }));

describe('settings panel accessibility', () => {
  it('connects the selected tab to its real panel with an opt-in id prefix', () => {
    const html = renderToStaticMarkup(createElement(Tabs, {
      items: [{ value: 'payments', label: 'Payments' }, { value: 'rates', label: 'Rates' }],
      value: 'rates', onChange: () => undefined, idPrefix: 'settings', label: 'Settings',
    }));
    expect(html).toContain('id="settings-tab-rates"');
    expect(html).toContain('aria-controls="settings-panel-rates"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toMatch(/id="settings-tab-rates"[^>]*aria-selected="true"/);
  });
  it('keeps existing callers without panel IDs backwards compatible', () => {
    const html = renderToStaticMarkup(createElement(Tabs, {
      items: [{ value: 'provider', label: 'Provider' }], value: 'provider', onChange: () => undefined,
    }));
    expect(html).not.toContain('aria-controls=');
    expect(html).toContain('aria-selected="true"');
  });
});
