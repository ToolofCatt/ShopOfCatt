import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { parseMailCodes, parseMailDelivery } from './mail-delivery';
import { mailSalePrice } from './mail-catalog.service';

describe('mail pricing and provider boundary', () => {
  it('multiplies decimal price exactly and honors an admin override', () => {
    expect(mailSalePrice({ cost: new Prisma.Decimal('0.033'), salePrice: null }, { multiplier: new Prisma.Decimal(2) }).toString()).toBe('0.066');
    expect(mailSalePrice({ cost: new Prisma.Decimal('0.033'), salePrice: new Prisma.Decimal('0.09') }, { multiplier: new Prisma.Decimal(2) }).toString()).toBe('0.09');
  });
  it('keeps full delivery text but only allows the documented fixed inbox origin/path', () => {
    const line = 'customer@example.test----https://gapi.mailsapi.com/api/get-code?uid=fixture_123';
    const parsed = parseMailDelivery(line);
    expect(parsed.deliveryText).toBe(line); expect(parsed.readUid).toBe('fixture_123');
    for (const url of ['http://169.254.169.254/latest/meta-data', 'https://gapi.mailsapi.com.evil.test/api/get-code?uid=x', 'https://gapi.mailsapi.com@evil.test/api/get-code?uid=x', 'https://gapi.mailsapi.com/redirect?uid=x', 'https://gapi.mailsapi.com/api/get-code?uid=x&redirect=https://evil.test']) {
      expect(parseMailDelivery('customer@example.test----'+url).readUrl).toBeNull();
    }
  });
  it('accepts only explicit codes, preserves leading zeroes, and never scrapes HTML numbers', () => {
    expect(parseMailCodes({ code: 0, data: { code: '001234' } })).toEqual(['001234']);
    expect(parseMailCodes({ code: 0, data: [{ code: '001234' }, { code: '001234' }, { code: '987654' }] })).toEqual(['001234', '987654']);
    expect(parseMailCodes({ code: 0, data: null })).toEqual([]);
    expect(() => parseMailCodes('<html>123456</html>')).toThrow();
    expect(() => parseMailCodes({ code: 404, data: null })).toThrow();
    expect(() => parseMailCodes({ code: 0, data: { code: 1234 } })).toThrow();
  });
});
