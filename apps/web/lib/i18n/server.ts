import { cookies } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from './config';
import { getDictionary, type Dictionary } from './index';

/**
 * Ngôn ngữ dùng cho server component: lựa chọn đã lưu trong cookie, nếu chưa có
 * thì DEFAULT_LOCALE.
 *
 * KHÔNG đoán theo Accept-Language nữa. Đoán thì "mặc định" không còn nghĩa gì:
 * cùng một cửa hàng, người mở bằng trình duyệt Việt thấy tiếng Việt còn người
 * khác thấy tiếng Anh, mà chủ shop không có cách nào chọn mặt tiền của mình.
 */
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const saved = cookieStore.get(LOCALE_COOKIE)?.value;
  return isLocale(saved) ? saved : DEFAULT_LOCALE;
}

export async function getServerDictionary(): Promise<{ locale: Locale; t: Dictionary }> {
  const locale = await getServerLocale();
  return { locale, t: getDictionary(locale) };
}
