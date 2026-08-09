export const LOCALES = ['vi', 'en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'vi';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Chọn ngôn ngữ từ header Accept-Language do web gửi lên.
 * Web gửi thẳng "vi" | "en" | "zh"; trình duyệt gọi trực tiếp có thể gửi
 * dạng đầy đủ ("zh-CN,zh;q=0.9") nên vẫn phân tích theo chuẩn.
 */
export function resolveLocaleFromHeader(header: unknown): Locale {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_LOCALE;
  if (isLocale(raw.trim())) return raw.trim() as Locale;

  const parts = raw
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
  return DEFAULT_LOCALE;
}
