import { en } from './dictionaries/en';
import { vi, type Dictionary } from './dictionaries/vi';
import { zh } from './dictionaries/zh';
import { LOCALE_DATE_TAG, type Locale } from './config';

export type { Dictionary };
export * from './config';

const DICTIONARIES: Record<Locale, Dictionary> = { vi, en, zh };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Định dạng ngày giờ theo ngôn ngữ đang chọn. */
export function formatDateTime(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(LOCALE_DATE_TAG[locale]);
}
