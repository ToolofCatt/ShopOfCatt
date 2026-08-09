'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_DATE_TAG,
  type Locale,
} from './config';
import { getDictionary, type Dictionary } from './index';

interface I18nContextValue {
  locale: Locale;
  /** Từ điển của ngôn ngữ hiện tại — truy cập trực tiếp: t.nav.orders */
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  /** Định dạng ngày giờ theo ngôn ngữ hiện tại. */
  formatDate: (value: string | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      setLocaleState(next);
      // Server component (trang chủ, trang sản phẩm) đọc cookie → render lại
      router.refresh();
    },
    [router],
  );

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = getDictionary(locale);
    return {
      locale,
      t: dictionary,
      setLocale,
      formatDate: (raw) =>
        raw ? new Date(raw).toLocaleString(LOCALE_DATE_TAG[locale]) : dictionary.common.dash,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n phải được dùng bên trong <I18nProvider>.');
  }
  return context;
}
