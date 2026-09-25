import { describe, expect, it } from 'vitest';
import { customerMailExport, publicMailName } from './mail-public';
describe('customer mail data', () => {
  it('removes supplier branding/URLs from service names without changing service identity', () => {
    expect(publicMailName('ChatGPT | 5Mail.io')).toBe('ChatGPT');
    expect(publicMailName('Telegram https://5mail.io/catalog')).toBe('Telegram');
    expect(publicMailName('Apple')).toBe('Apple');
  });
  it('exports only owned email and codes even if delivery text contains provider capabilities', () => {
    const rows = [{ account: 'buyer@example.test', deliveryText: 'buyer@example.test----https://gapi.mailsapi.com/api/get-code?uid=secret', readUrl: 'https://gapi.mailsapi.com/api/get-code?uid=secret', codes: [{ code: '001234' }] }];
    expect(customerMailExport(rows)).toBe('buyer@example.test\t001234');
  });
});
