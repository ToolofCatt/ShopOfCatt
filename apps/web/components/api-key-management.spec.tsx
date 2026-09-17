import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ApiAccountDto, ApiKeyDto } from '@webcatt/shared';
import { partnerUxEn } from '../lib/i18n/dictionaries/partner-ux';
import { ApiKeyForm, ApiKeyList, ApiAccessActions, ApiSecretDialog, restoreApiDialogFocus } from './api-key-management';

vi.mock('@/lib/i18n/client', () => ({ useI18n: () => ({ t: { partnerApi: partnerUxEn }, formatDate: (value: string) => value }) }));
const key: ApiKeyDto = { id: 'fixture', name: '<server>', prefix: 'prefix-only', scopes: ['orders:write'], createdAt: '2026-09-01T00:00:00Z', expiresAt: '2099-10-01T00:00:00Z', revokedAt: null, lastUsedAt: null };
const account: ApiAccountDto = { userId: 'fixture-account', code: 123, email: null, name: 'Fixture', locked: false, access: { enabled: false, approvedAt: null, disabledAt: null }, activeKeys: 0 };

describe('API dialog focus restoration', () => {
  function target(connected = true, disabled = false) {
    return { isConnected: connected, matches: (selector: string) => selector === ':disabled' && disabled, focus: vi.fn() };
  }

  it('prefers the submitter captured before pending over the body observed after the response', () => {
    const submitter = target(), body = target(), fallback = target();
    restoreApiDialogFocus(submitter as unknown as HTMLElement, body as unknown as HTMLElement, fallback as unknown as HTMLElement);
    expect(submitter.focus).toHaveBeenCalledOnce();
    expect(body.focus).not.toHaveBeenCalled();
    expect(fallback.focus).not.toHaveBeenCalled();
  });

  it.each([{ connected: true, disabled: true }, { connected: false, disabled: false }])('uses the list heading if the trigger cannot receive focus: %j', ({ connected, disabled }) => {
    const submitter = target(connected, disabled), body = target(), fallback = target();
    restoreApiDialogFocus(submitter as unknown as HTMLElement, body as unknown as HTMLElement, fallback as unknown as HTMLElement);
    expect(submitter.focus).not.toHaveBeenCalled();
    expect(body.focus).not.toHaveBeenCalled();
    expect(fallback.focus).toHaveBeenCalledOnce();
  });

  it('keeps synchronous confirmation dialogs returning to the previously focused control', () => {
    const previous = target();
    restoreApiDialogFocus(null, previous as unknown as HTMLElement, null);
    expect(previous.focus).toHaveBeenCalledOnce();
  });
});

describe('partner API screen semantics', () => {
  it('renders labelled form fields with read-only defaults and no write checkbox selected', () => {
    const html = renderToStaticMarkup(createElement(ApiKeyForm, { disabled: false, busy: false, onCreate() {} }));
    expect(html).toContain('for="api-key-name"');
    expect(html).toContain('for="api-key-expiry"');
    expect(html).toContain('value="30"');
    expect(html.match(/checked=""/g)).toHaveLength(4);
    expect(html).toContain('orders:write');
    expect(html).not.toContain('localStorage');
  });
  it('disables all creation controls while approval is missing or creation is unresolved', () => {
    const html = renderToStaticMarkup(createElement(ApiKeyForm, { disabled: true, busy: false, onCreate() {} }));
    expect(html).toContain('<fieldset disabled=""');
  });
  it('renders escaped metadata, not unexpected secret fields from a response', () => {
    const html = renderToStaticMarkup(createElement(ApiKeyList, { keys: [{ ...key, secret: 'must-not-display' } as ApiKeyDto], onRevoke() {}, canRevoke: false }));
    expect(html).toContain('&lt;server&gt;');
    expect(html).toContain('prefix-only');
    expect(html).not.toContain('must-not-display');
    expect(html).not.toContain('>Revoke<');
  });
  it('keeps ADMIN metadata-only and reserves access actions for SUPERADMIN', () => {
    const readonly = renderToStaticMarkup(createElement(ApiAccessActions, { account, role: 'ADMIN', onChange() {} }));
    expect(readonly).not.toContain('<button');
    const owner = renderToStaticMarkup(createElement(ApiAccessActions, { account, role: 'SUPERADMIN', onChange() {} }));
    expect(owner).toContain('Enable API access');
  });
  it('renders no dialog or secret when closed, and labels the one-time secret when open', () => {
    expect(renderToStaticMarkup(createElement(ApiSecretDialog, { secret: null, onDiscard() {} }))).toBe('');
    const html = renderToStaticMarkup(createElement(ApiSecretDialog, { secret: 'synthetic-secret', onDiscard() {} }));
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby=');
    expect(html.toLowerCase()).toContain('readonly=""');
    expect(html.toLowerCase()).toContain('autocomplete="off"');
    expect(html).toContain('synthetic-secret');
  });
});
