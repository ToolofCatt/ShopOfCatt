'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  convertFromUsdt,
  displayPriceAmount,
  formatMoney,
  formatUsdt,
  type AnchoredPrice,
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
  /**
   * Giá hiện cho khách, theo đúng đơn vị của ngôn ngữ đang xem.
   *
   * CHỈ một dòng — không kèm "≈ x USDT". Chủ shop muốn khách thấy đúng một con
   * số bằng tiền của họ; số tiền thật sự thu vẫn hiện ở trang thanh toán, nơi
   * luôn ghi đúng đơn vị sẽ thu.
   */
  primary: string;
}

export interface PriceFormatter {
  /**
   * Giá của một loại hàng, theo đúng NEO của nó.
   *
   * Khách xem đúng đơn vị đã neo ⇒ hiện nguyên con số chủ shop đã gõ (số tròn).
   * Xem đơn vị khác ⇒ quy đổi từ USDT.
   */
  price: (p: AnchoredPrice) => DisplayPrice;
  /** Giá thuần USDT — dùng cho những chỗ chỉ có con số, không có neo. */
  priceUsdt: (usdt: number) => DisplayPrice;
  /**
   * Ba con số tiền của một đơn, quy về đơn vị khách đang xem.
   *
   * Trả về cả ba cùng lúc chứ không quy từng số riêng lẻ, vì ₫ làm tròn LÊN:
   * quy riêng thì hoá đơn không cộng khớp (100.000 − 9.847 ≠ 90.153). Ở đây số
   * giảm giá được lấy bằng HIỆU của hai số đã làm tròn, nên bao giờ cũng khớp.
   */
  orderMoney: (
    subtotalUsdt: number,
    discountUsdt: number,
    totalUsdt: number,
  ) => { subtotal: string; discount: string; total: string };
  /**
   * Quy đổi ra MỌI đơn vị cùng lúc — cho ô nhập giá bên quản trị.
   *
   * Khác `price`: chủ shop cần thấy hết để biết khách ở từng ngôn ngữ sẽ thấy
   * con số nào, chứ không chỉ đơn vị ứng với ngôn ngữ mình đang xem.
   * `null` = chưa có tỉ giá nào, không có gì để hiện.
   */
  allConversions: (usdt: number) => string | null;
}

/** Tỉ giá thô — ô nhập giá cần tự quy đổi hai chiều, không chỉ định dạng. */
export function useRates(): StoreRatesDto | null {
  return useContext(RatesContext);
}

export function usePrices(): PriceFormatter {
  const { locale } = useI18n();
  const rates = useContext(RatesContext);
  // Đơn vị suy THẲNG từ ngôn ngữ khách đang xem, không có cấu hình nào chen vào.
  const currency = CURRENCY_BY_LOCALE[locale];

  return useMemo(() => {
    const price = (p: AnchoredPrice): DisplayPrice => {
      const { amount, currency: dv } = displayPriceAmount(p, currency, rates);
      return { primary: formatMoney(amount, dv) };
    };
    const priceUsdt = (usdt: number): DisplayPrice => {
      // `null` = chưa có tỉ giá cho đơn vị này ⇒ lùi về USDT, không bịa số.
      const converted = convertFromUsdt(usdt, currency, rates);
      if (converted === null) {
        return { primary: formatUsdt(usdt) };
      }
      return { primary: formatMoney(converted, currency) };
    };
    const orderMoney = (
      subtotalUsdt: number,
      discountUsdt: number,
      totalUsdt: number,
    ) => {
      const st = convertFromUsdt(subtotalUsdt, currency, rates);
      const tt = convertFromUsdt(totalUsdt, currency, rates);
      if (st === null || tt === null) {
        // Không quy đổi được ⇒ hiện USDT y như trước, không bịa số.
        return {
          subtotal: formatUsdt(subtotalUsdt),
          discount: formatUsdt(discountUsdt),
          total: formatUsdt(totalUsdt),
        };
      }
      // Làm tròn về đúng độ chính xác sẽ HIỆN, rồi mới trừ.
      const chot = (v: number) =>
        currency === 'VND' ? Math.ceil(v) : Math.round(v * 100) / 100;
      const s = chot(st);
      const t = chot(tt);
      return {
        subtotal: formatMoney(s, currency),
        discount: formatMoney(s - t, currency),
        total: formatMoney(t, currency),
      };
    };
    const allConversions = (usdt: number): string | null => {
      if (!Number.isFinite(usdt) || usdt <= 0) return null;
      const phan: string[] = [];
      for (const dv of ['VND', 'CNY', 'USD'] as const) {
        const so = convertFromUsdt(usdt, dv, rates);
        if (so !== null) phan.push(formatMoney(so, dv));
      }
      return phan.length > 0 ? phan.join('  ·  ') : null;
    };

    return { price, priceUsdt, orderMoney, allConversions };
  }, [currency, rates]);
}
