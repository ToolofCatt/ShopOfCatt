import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_PATTERN = /^catt_(c[a-z0-9]{24})\.([A-Za-z0-9_-]{43})$/;

export function createApiKeyMaterial(): { secret: string; digest: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, digest: createHash('sha256').update(secret).digest('hex') };
}

export function formatApiKey(id: string, secret: string): string {
  return `catt_${id}.${secret}`;
}

export function parseApiKey(raw: string): { id: string; secret: string } | null {
  if (raw.length > 100) return null;
  const match = API_KEY_PATTERN.exec(raw);
  if (!match) return null;
  const secret = match[2];
  // Chặn cách mã hóa không chuẩn có cùng bytes nhưng khác chuỗi xác thực.
  if (Buffer.from(secret, 'base64url').toString('base64url') !== secret) return null;
  return { id: match[1], secret };
}

export function verifyApiKeySecret(secret: string, digest: string): boolean {
  // timingSafeEqual ném lỗi khi khác độ dài; dữ liệu DB lỗi cũng phải fail-closed.
  if (!/^[a-f0-9]{64}$/.test(digest)) return false;
  const candidate = createHash('sha256').update(secret).digest();
  return timingSafeEqual(candidate, Buffer.from(digest, 'hex'));
}
