import type { DisplayCurrency } from '@webcatt/shared';

export const LOCALES = ['vi', 'en', 'zh'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Tiền hiện cho khách, theo ngôn ngữ đang xem.
 *
 * Giá gốc LUÔN là USDT; đây chỉ là lớp quy đổi để hiển thị. USD coi như 1:1 với
 * USDT nên tiếng Anh không cần tỉ giá nào.
 */
export const CURRENCY_BY_LOCALE = {
  vi: 'VND',
  en: 'USD',
  zh: 'CNY',
} as const satisfies Record<Locale, DisplayCurrency>;

export const DEFAULT_LOCALE: Locale = 'vi';

/** Cookie giữ ngôn ngữ người dùng chọn (server component đọc được). */
export const LOCALE_COOKIE = 'wc_locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Tên ngôn ngữ hiển thị trong bộ chọn — luôn viết bằng chính ngôn ngữ đó. */
export const LOCALE_LABELS: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  zh: '中文',
};

/** Nhãn ngắn hiển thị trên nút. */
export const LOCALE_SHORT: Record<Locale, string> = {
  vi: 'VN',
  en: 'EN',
  zh: 'ZH',
};

/** Giá trị thuộc tính lang của thẻ <html>. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  vi: 'vi',
  en: 'en',
  zh: 'zh-CN',
};

/** Locale dùng cho toLocaleString khi định dạng ngày giờ. */
export const LOCALE_DATE_TAG: Record<Locale, string> = {
  vi: 'vi-VN',
  en: 'en-US',
  zh: 'zh-CN',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Chuẩn hoá giá trị bất kỳ (cookie, query, header) về một Locale hợp lệ. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Chọn ngôn ngữ từ header Accept-Language của trình duyệt.
 * Dùng khi người dùng chưa từng chọn ngôn ngữ.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const quality = qParam ? Number.parseFloat(qParam.split('=')[1]) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of parts) {
    if (tag.startsWith('vi')) return 'vi';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('en')) return 'en';
  }
  return null;
}
