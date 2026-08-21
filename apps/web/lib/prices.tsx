'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  convertFromUsdt,
  formatMoney,
  formatUsdt,
  type StoreRatesDto,
} from '@webcatt/shared';
import { CURRENCY_BY_LOCALE } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';

/**
 * Hiện giá theo ngôn ngữ khách đang chọn: vi → ₫, zh → ¥, en → $.
 *
 * Tỉ giá được NẠP SẴN TỪ MÁY CHỦ và truyền xuống qua provider, không fetch ở
 * trình duyệt: thẻ sản phẩm hiện ngay lúc trang mở, mà fetch sau đó thì giá nhảy
 * từ USDT sang tiền địa phương ngay trước mắt khách.
 *
 * Không có tỉ giá (chưa cấu hình, hoặc lần lấy nào cũng lỗi) thì lặng lẽ hiện
 * USDT như trước — thà hiện đơn vị gốc còn hơn hiện một con số bịa.
 */
const RatesContext = createContext<StoreRatesDto | null>(null);

export function RatesProvider({
  rates,
  children,
}: {
  rates: StoreRatesDto | null;
  children: ReactNode;
}) {
  return <RatesContext.Provider value={rates}>{children}</RatesContext.Provider>;
}

export interface DisplayPrice {
  /** Dòng lớn: tiền địa phương, hoặc USDT khi không quy đổi được. */
  primary: string;
  /** Dòng nhỏ "≈ 3.50 USDT"; `null` khi dòng lớn đã là USDT. */
  secondary: string | null;
}

export interface PriceFormatter {
  price: (usdt: number) => DisplayPrice;
}

export function usePrices(): PriceFormatter {
  const { locale } = useI18n();
  const rates = useContext(RatesContext);
  const currency = CURRENCY_BY_LOCALE[locale];

  return useMemo(() => {
    const price = (usdt: number): DisplayPrice => {
      // `null` = chưa có tỉ giá cho đơn vị này ⇒ lùi về USDT, không bịa số.
      const converted = convertFromUsdt(usdt, currency, rates);
      if (converted === null) {
        return { primary: formatUsdt(usdt), secondary: null };
      }
      /*
       * Dòng phụ vẫn hiện kể cả với USD, dù con số y hệt.
       *
       * Không phải để so sánh giá mà để nói rõ ĐƠN VỊ THU: khách thấy "$3.50" dễ
       * tưởng trả bằng thẻ đô, còn cửa hàng chỉ nhận USDT (hoặc VND chuyển khoản).
       */
      return { primary: formatMoney(converted, currency), secondary: formatUsdt(usdt) };
    };
    return { price };
  }, [currency, rates]);
}
