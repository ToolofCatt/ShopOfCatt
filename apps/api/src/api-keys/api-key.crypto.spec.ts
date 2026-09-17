import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApiKeyMaterial, formatApiKey, parseApiKey, verifyApiKeySecret } from './api-key.crypto';

const ID = 'cm00000000000000000000000';

describe('API key cryptography', () => {
  it('creates independent 32-byte secrets with only SHA-256 digests for storage', () => {
    const first = createApiKeyMaterial();
    const second = createApiKeyMaterial();
    expect(Buffer.from(first.secret, 'base64url')).toHaveLength(32);
    expect(first.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.secret).not.toBe(second.secret);
    expect(first.digest).toBe(createHash('sha256').update(first.secret).digest('hex'));
    expect(first.digest).not.toContain(first.secret);
  });

  it('round-trips the public CUID and secret without putting secret in prefix', () => {
    const { secret } = createApiKeyMaterial();
    expect(formatApiKey(ID, secret)).toBe(`catt_${ID}.${secret}`);
    expect(parseApiKey(formatApiKey(ID, secret))).toEqual({ id: ID, secret });
  });

  it.each(['', 'eyJ.jwt.token', 'Bearer catt_id.secret', 'catt_x.short', `catt_${ID}.${'a'.repeat(42)}`, `catt_${ID}.${'a'.repeat(43)}.extra`, ` catt_${ID}.${'a'.repeat(43)}`, `catt_${ID}.${'a'.repeat(43)}=`])('rejects malformed token %s', (raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });

  it('rejects a different secret and malformed stored digests without timingSafeEqual errors', () => {
    const material = createApiKeyMaterial();
    expect(verifyApiKeySecret(material.secret, material.digest)).toBe(true);
    expect(verifyApiKeySecret(createApiKeyMaterial().secret, material.digest)).toBe(false);
    for (const digest of ['', '00', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(66)]) {
      expect(verifyApiKeySecret(material.secret, digest)).toBe(false);
    }
  });
});
