import { createHash } from 'node:crypto';

export function parseMailDelivery(text: string) {
  const account = text.split('----')[0]?.trim();
  if (!account || !/^[^\s@<>]{1,128}@[^\s@<>]{1,190}$/.test(account)) throw new Error('invalid mail');
  const raw = text.split('----').find(part => part.startsWith('https://gapi.mailsapi.com/'));
  let readUrl: string | null = null, readUid: string | null = null;
  if (raw) {
    const url = new URL(raw.trim());
    if (url.origin === 'https://gapi.mailsapi.com' && url.pathname === '/api/get-code' && !url.username && !url.password && !url.hash && [...url.searchParams.keys()].every(k => k === 'uid')) {
      const uid = url.searchParams.get('uid');
      if (uid && /^[A-Za-z0-9_-]{1,200}$/.test(uid)) { readUid = uid; readUrl = url.toString(); }
    }
  }
  return { account, deliveryText: text, readUrl, readUid, providerIdentity: createHash('sha256').update(readUid ? 'uid:'+readUid : 'account:'+account.toLowerCase()).digest('hex') };
}

/** Chỉ nhận mã ở field rõ ràng, không quét số bất kỳ từ HTML/email thành OTP. */
export function parseMailCodes(value: unknown): string[] {
  if (typeof value === 'string' && /^[0-9]{4,10}$/.test(value.trim())) return [value.trim()];
  if (!value || typeof value !== 'object') throw new Error('unsupported inbox');
  const payload = value as { code?: unknown; data?: unknown };
  if (payload.code !== 0) throw new Error('provider not ready');
  if (payload.data === null) return [];
  const data = payload.data;
  if (!data || typeof data !== 'object') throw new Error('invalid inbox');
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length > 1000) throw new Error('inbox limit');
  const codes: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('invalid row');
    const code = (row as { code?: unknown }).code;
    if (code === null || code === undefined || code === '') continue;
    if (typeof code !== 'string' || !/^[0-9]{4,10}$/.test(code)) throw new Error('invalid code');
    codes.push(code);
  }
  return [...new Set(codes)];
}
