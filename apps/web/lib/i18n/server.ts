import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
  type Locale,
} from './config';
import { getDictionary, type Dictionary } from './index';

/**
 * Ngôn ngữ dùng cho server component: ưu tiên lựa chọn đã lưu trong cookie,
 * nếu chưa có thì đoán theo header Accept-Language của trình duyệt.
 */
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const saved = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;

  const headerStore = await headers();
  return localeFromAcceptLanguage(headerStore.get('accept-language')) ?? DEFAULT_LOCALE;
}

export async function getServerDictionary(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getServerLocale();
  return { locale, t: getDictionary(locale) };
}
