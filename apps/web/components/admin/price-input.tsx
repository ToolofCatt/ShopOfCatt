'use client';

import { useMemo } from 'react';
import {
  convertFromUsdt,
  floorUsdt,
  formatMoney,
  toUsdtFromCurrency,
  type DisplayCurrency,
  type StoreRatesDto,
} from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { useRates } from '@/lib/prices';
import { Input } from '@/components/ui';
import { Tabs } from '@/components/admin/tabs';

/**
 * Ô nhập giá có chọn đơn vị — và đơn vị đó là cái NEO của giá.
 *
 * Con số chủ shop gõ được lưu NGUYÊN VĂN cùng đơn vị của nó; số USDT chỉ là số
 * dẫn xuất. Nhờ vậy gõ 100.000 ₫ là khách Việt thấy đúng 100.000 ₫ hôm nay và cả
 * tháng sau, dù tỉ giá đã trôi.
 *
 * Trước đây ô này quy ngay sang USDT rồi bỏ con số đã gõ, nên phải có một bộ đệm
 * `raw` mới gõ được (mỗi ký tự bị đổi qua USDT rồi đổi ngược lại thành "0"). Nay
 * số đã gõ CHÍNH LÀ dữ liệu nên bộ đệm đó không còn cần.
 */

export interface PriceInputProps {
  id: string;
  /** Số tiền chủ shop gõ, dạng chuỗi — đúng thứ biểu mẫu gửi lên. */
  value: string;
  /** Đơn vị của `value` — cái neo. */
  currency: DisplayCurrency;
  onChange: (amount: string, currency: DisplayCurrency) => void;
  invalid?: boolean;
  placeholder?: string;
}

/** Đơn vị nhập được: USDT/USD luôn có, ₫ và ¥ cần tỉ giá đã cấu hình. */
function unitsAvailable(rates: StoreRatesDto | null): DisplayCurrency[] {
  const ds: DisplayCurrency[] = ['USDT', 'USD'];
  if (rates && rates.vndPerUsdt > 0) ds.splice(1, 0, 'VND');
  if (rates && rates.cnyPerUsdt > 0) ds.push('CNY');
  return ds;
}

export function PriceInput({
  id,
  value,
  currency,
  onChange,
  invalid,
  placeholder,
}: PriceInputProps) {
  const { t } = useI18n();
  const rates = useRates();
  const units = useMemo(() => unitsAvailable(rates), [rates]);

  const soDaGo = Number(value);
  const hopLe = value.trim() !== '' && Number.isFinite(soDaGo) && soDaGo > 0;

  const doiDonVi = (moi: DisplayCurrency) => {
    /*
      Đổi đơn vị thì chuyển con số sang đơn vị mới để chủ shop thấy giá tương
      đương, KHÔNG giữ nguyên con số — bấm từ ₫ sang USDT mà vẫn để "100000" là
      giá nhảy lên một trăm nghìn đô.
    */
    if (moi === currency) return;
    if (!hopLe) {
      onChange(value, moi);
      return;
    }
    const usdt = toUsdtFromCurrency(soDaGo, currency, rates);
    const doi = usdt === null ? null : convertFromUsdt(usdt, moi, rates);
    if (doi === null) {
      onChange(value, moi);
      return;
    }
    onChange(String(round(doi, moi === 'VND' ? 0 : 2)), moi);
  };

  /*
    Dòng dưới ô nhập liệt kê giá ở MỌI đơn vị, bắt đầu bằng đơn vị đang neo.

    Đơn vị neo hiện đúng số đã gõ. Các đơn vị còn lại là số quy đổi và chúng
    không tròn — không có cách nào một con số tròn ở hai đơn vị cùng lúc. Chủ shop
    cần thấy hết để biết khách ở từng ngôn ngữ sẽ thấy con số nào.
  */
  const goiY = useMemo(() => {
    if (!hopLe) return null;
    const usdtTho = toUsdtFromCurrency(soDaGo, currency, rates);
    if (usdtTho === null) return null;
    // Làm tròn xuống ĐÚNG như máy chủ sẽ lưu, để dòng gợi ý không hứa một con số
    // khác với con số thật sau khi bấm Lưu.
    const usdt = floorUsdt(usdtTho);

    const phan: string[] = [formatMoney(soDaGo, currency)];
    for (const dv of ['USDT', 'VND', 'CNY', 'USD'] as const) {
      if (dv === currency) continue;
      const so = convertFromUsdt(usdt, dv, rates);
      if (so === null) continue;
      /*
        USDT hiện ĐỦ chữ số, không dùng `formatMoney` (hai chữ số).

        Với khách trả crypto thì đây chính là số họ phải chuyển, và bộ đối soát
        đòi khớp chính xác. Ghi "3.85" trong khi số thật là 3.852198 là mời chủ
        shop báo cho khách một con số thiếu, rồi đơn treo chờ xử lý tay.
      */
      phan.push(dv === 'USDT' ? `${usdtDayDu(so)} USDT` : formatMoney(so, dv));
    }
    return phan.join('  ·  ');
  }, [hopLe, soDaGo, currency, rates]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step={currency === 'VND' ? 1 : 0.01}
          inputMode="decimal"
          value={value}
          invalid={invalid}
          placeholder={placeholder}
          className="min-w-0 flex-1"
          onChange={(event) => onChange(event.target.value, currency)}
        />
        {units.length > 1 && (
          <Tabs
            items={units.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
            value={currency}
            onChange={doiDonVi}
          />
        )}
      </div>
      {goiY && (
        <p className="text-xs text-neutral-500">
          {t.admin.priceAnchoredAt(UNIT_LABEL[currency])} {goiY}
        </p>
      )}
    </div>
  );
}

const UNIT_LABEL: Record<DisplayCurrency, string> = {
  USDT: 'USDT',
  VND: '₫',
  CNY: '¥',
  USD: '$',
};

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** USDT với đủ sáu chữ số, cắt số 0 vô nghĩa ở cuối nhưng giữ tối thiểu hai. */
function usdtDayDu(usdt: number): string {
  const [nguyen, le = ''] = usdt.toFixed(6).split('.');
  return `${nguyen}.${le.replace(/0+$/, '').padEnd(2, '0')}`;
}
