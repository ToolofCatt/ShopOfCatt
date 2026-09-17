import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { buildApiKeyInput, initialKeyCreation, keyCreationReducer, isUnknownKeyCreation, apiKeyStatus, partnerPublicBaseUrl, partnerCodeSamples } from './api-key';
import type { ApiKeyDto } from '@webcatt/shared';

const key: ApiKeyDto = { id: 'key-fixture', name: 'Test', prefix: 'prefix-only', scopes: ['orders:read'], createdAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z', revokedAt: null, lastUsedAt: null };

describe('partner key form boundary', () => {
  it('defaults to read-only scopes and thirty days without enabling spending', () => {
    expect(buildApiKeyInput('  Worker  ')).toEqual({ name: 'Worker', scopes: ['catalog:read', 'wallet:read', 'deposits:read', 'orders:read'], expiresInDays: 30 });
  });
  it('keeps explicitly chosen write scopes without silently granting reads', () => {
    expect(buildApiKeyInput('Worker', ['orders:write'], 90)).toEqual({ name: 'Worker', scopes: ['orders:write'], expiresInDays: 90 });
  });
  it('rejects blank names, no scopes, unknown scopes, and invalid expiry', () => {
    for (const days of [0, 91, 1.5, NaN]) expect(() => buildApiKeyInput('Worker', ['catalog:read'], days)).toThrow();
    expect(() => buildApiKeyInput('   ')).toThrow();
    expect(() => buildApiKeyInput('Worker', [])).toThrow();
    expect(() => buildApiKeyInput('Worker', ['admin:write' as never])).toThrow();
  });
});

describe('one-time secret lifecycle', () => {
  it('only accepts a secret for an in-flight create and discards it on close or navigation', () => {
    const creating = keyCreationReducer(initialKeyCreation, { type: 'start' });
    const shown = keyCreationReducer(creating, { type: 'created', secret: 'synthetic-test-secret' });
    expect(shown.secret).toBe('synthetic-test-secret');
    expect(keyCreationReducer(shown, { type: 'discard' }).secret).toBeNull();
    expect(keyCreationReducer(initialKeyCreation, { type: 'created', secret: 'late-result' }).secret).toBeNull();
    expect(keyCreationReducer(keyCreationReducer(creating, { type: 'discard' }), { type: 'created', secret: 'late-result' }).secret).toBeNull();
  });
  it('blocks another create after an unknown outcome until metadata has been reloaded', () => {
    const unknown = keyCreationReducer(keyCreationReducer(initialKeyCreation, { type: 'start' }), { type: 'unknown' });
    expect(unknown.phase).toBe('uncertain');
    expect(keyCreationReducer(unknown, { type: 'start' }).phase).toBe('uncertain');
    expect(keyCreationReducer(unknown, { type: 'metadataReloaded' }).phase).toBe('idle');
    expect(unknown.secret).toBeNull();
  });
  it('forgets a displayed secret on pagehide but keeps an in-flight create uncertain', () => {
    const creating = keyCreationReducer(initialKeyCreation, { type: 'start' });
    expect(keyCreationReducer(creating, { type: 'pageHidden' })).toEqual({ phase: 'uncertain', secret: null });
    const revealed = keyCreationReducer(creating, { type: 'created', secret: 'synthetic-test-secret' });
    expect(keyCreationReducer(revealed, { type: 'pageHidden' })).toEqual({ phase: 'idle', secret: null });
  });
  it('treats network, malformed success and server errors as unknown rather than retryable creation', () => {
    expect(isUnknownKeyCreation(new ApiError('network', 0))).toBe(true);
    expect(isUnknownKeyCreation(new ApiError('server', 500))).toBe(true);
    expect(isUnknownKeyCreation(new SyntaxError('malformed response'))).toBe(true);
    expect(isUnknownKeyCreation(new ApiError('denied', 403))).toBe(false);
  });
  it('distinguishes expired, revoked and currently active metadata', () => {
    const now = Date.parse('2026-09-17T00:00:00Z');
    expect(apiKeyStatus(key, now)).toBe('active');
    expect(apiKeyStatus({ ...key, expiresAt: '2026-09-17T00:00:00Z' }, now)).toBe('expired');
    expect(apiKeyStatus({ ...key, revokedAt: '2026-09-10T00:00:00Z' }, now)).toBe('revoked');
  });
});

describe('public partner documentation examples', () => {
  it('uses the public API origin and never requires an internal server address', () => {
    expect(partnerPublicBaseUrl('/api', 'https://shop.example')).toBe('https://shop.example/api/v1');
    expect(partnerPublicBaseUrl('https://api.example/api/', 'https://shop.example')).toBe('https://api.example/api/v1');
    expect(partnerPublicBaseUrl(undefined, undefined)).toBe('/api/v1');
    expect(partnerPublicBaseUrl('javascript:alert(1)', 'https://shop.example')).toBe('https://shop.example/api/v1');
  });
  it('reads API credentials from the environment and uses GET without exposing delivered order keys', () => {
    const samples = partnerCodeSamples('https://shop.example/api/v1');
    for (const sample of Object.values(samples)) {
      expect(sample).toContain('CATT_API_KEY');
      expect(sample).toContain('/products');
      expect(sample).not.toContain('POST');
      expect(sample).not.toContain('localStorage');
    }
    expect(samples.python).toContain('urllib.request');
    expect(samples.node).toContain('process.env.CATT_API_KEY');
  });
});
