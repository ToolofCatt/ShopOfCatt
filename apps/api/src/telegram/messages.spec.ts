import { describe, expect, it } from 'vitest';
import { botDict, botLang } from './messages';
import { tgDisplayName } from './telegram-api';

describe('botLang', () => {
  it('nhận dạng tiếng Việt và biến thể vùng', () => {
    expect(botLang('vi')).toBe('vi');
    expect(botLang('vi-VN')).toBe('vi');
  });

  it('mọi biến thể tiếng Trung về chung zh', () => {
    expect(botLang('zh')).toBe('zh');
    expect(botLang('zh-hans')).toBe('zh');
    expect(botLang('zh-TW')).toBe('zh');
  });

  it('không rõ nguồn gốc thì mặc định tiếng Anh — cùng lựa chọn với web', () => {
    expect(botLang(undefined)).toBe('en');
    expect(botLang('')).toBe('en');
    expect(botLang('fr')).toBe('en');
    // "vietnam" KHÔNG phải mã vi — chỉ nhận "vi" hoặc "vi-*"
    expect(botLang('vietnam')).toBe('en');
  });

  it('không phân biệt hoa thường (Telegram gửi thường, nhưng đừng tin)', () => {
    expect(botLang('VI')).toBe('vi');
    expect(botLang('ZH-Hans')).toBe('zh');
  });
});

describe('botDict', () => {
  it('cả ba ngôn ngữ đều trả về câu không rỗng', () => {
    for (const lang of ['vi', 'en', 'zh'] as const) {
      const dict = botDict(lang);
      expect(dict.start.length).toBeGreaterThan(0);
      expect(dict.notReady.length).toBeGreaterThan(0);
    }
  });
});

describe('tgDisplayName', () => {
  it('ghép tên và username', () => {
    expect(
      tgDisplayName({ id: 1, first_name: 'An', last_name: 'Nguyễn', username: 'an123' }),
    ).toBe('An Nguyễn (@an123)');
  });

  it('thiếu phần nào thì bỏ phần đó, không để lại ngoặc rỗng', () => {
    expect(tgDisplayName({ id: 1, first_name: 'An' })).toBe('An');
    expect(tgDisplayName({ id: 1, username: 'an123' })).toBe('@an123');
    expect(tgDisplayName({ id: 1 })).toBe('');
    expect(tgDisplayName(undefined)).toBe('');
  });
});
