'use client';

import { useMemo, useState } from 'react';
import {
  convertFromUsdt,
  formatMoney,
  formatUsdt,
  type DisplayCurrency,
  type StoreRatesDto,
} from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { useRates } from '@/lib/prices';
import { Input } from '@/components/ui';
import { Tabs } from '@/components/admin/tabs';

/**
 * Ô nhập giá có chọn đơn vị.
 *
 * Chủ shop nghĩ bằng tiền Việt nhưng CSDL lưu USDT, nên trước đây phải tự chia
 * tỉ giá trong đầu rồi gõ vào. Nay gõ 130268 rồi chọn ₫ là xong.
 *
 * Giá trị đi ra ngoài LUÔN là USDT — đơn vị chỉ là lớp nhập liệu. Đổi cách lưu
 * là đổi luôn cách tính tiền của cả hệ thống, không đáng chỉ vì chuyện gõ số.
 */

/** Cột giá là Decimal(18,2) nên USDT chỉ có hai số lẻ. */
const USDT_DECIMALS = 2;

export interface PriceInputProps {
  id: string;
  /** Giá bằng USDT, dạng chuỗi — đúng thứ biểu mẫu gửi lên. */
  value: string;
  onChange: (usdt: string) => void;
  invalid?: boolean;
  placeholder?: string;
}

/** Đơn vị nhập được: USDT luôn có, còn lại phụ thuộc tỉ giá đã cấu hình. */
function unitsAvailable(rates: StoreRatesDto | null): DisplayCurrency[] {
  const ds: DisplayCurrency[] = ['USDT', 'USD'];
  if (rates && rates.vndPerUsdt > 0) ds.splice(1, 0, 'VND');
  if (rates && rates.cnyPerUsdt > 0) ds.push('CNY');
  return ds;
}

function toUsdt(amount: number, unit: DisplayCurrency, rates: StoreRatesDto | null): number | null {
  if (unit === 'USDT' || unit === 'USD') return amount;
  if (!rates) return null;
  const rate = unit === 'VND' ? rates.vndPerUsdt : rates.cnyPerUsdt;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

export function PriceInput({ id, value, onChange, invalid, placeholder }: PriceInputProps) {
  const { t } = useI18n();
  const rates = useRates();
  const units = useMemo(() => unitsAvailable(rates), [rates]);

  const [unit, setUnit] = useState<DisplayCurrency>('USDT');
  /*
    Bộ đệm cho những gì đang gõ. `null` = chưa gõ gì, lấy từ `value` mà suy ra.

    Cần bộ đệm vì gõ ở đơn vị khác USDT thì mỗi ký tự bị đổi qua USDT rồi đổi
    ngược lại — gõ "13" thành 0.00 USDT rồi hiện lại "0", và không gõ tiếp được.
  */
  const [raw, setRaw] = useState<string | null>(null);

  const usdtNumber = Number(value);
  const hienThi =
    raw ??
    (value.trim() === '' || !Number.isFinite(usdtNumber)
      ? value
      : unit === 'USDT'
        ? value
        : String(round(convertFromUsdt(usdtNumber, unit, rates) ?? usdtNumber, unit === 'VND' ? 0 : 2)));

  const doiDonVi = (moi: DisplayCurrency) => {
    /*
      Đổi đơn vị thì chuyển con số sang đơn vị mới, KHÔNG đổi giá đã lưu — bấm
      qua lại giữa ₫ và USDT không được làm giá nhảy.
    */
    setUnit(moi);
    if (value.trim() === '' || !Number.isFinite(usdtNumber)) {
      setRaw(null);
      return;
    }
    if (moi === 'USDT') {
      setRaw(value);
      return;
    }
    const doi = convertFromUsdt(usdtNumber, moi, rates);
    setRaw(doi === null ? value : String(round(doi, moi === 'VND' ? 0 : 2)));
  };

  const goVao = (text: string) => {
    setRaw(text);
    if (text.trim() === '') {
      onChange('');
      return;
    }
    const so = Number(text);
    if (!Number.isFinite(so)) {
      onChange(text); // để phần kiểm tra của biểu mẫu báo lỗi như cũ
      return;
    }
    const usdt = toUsdt(so, unit, rates);
    onChange(usdt === null ? text : usdt.toFixed(USDT_DECIMALS));
  };

  /*
    Dòng dưới ô nhập nói RÕ con số sẽ được lưu.

    Bắt buộc phải có khi nhập bằng ₫: 100.000 ₫ chia tỉ giá ra 3.8383… USDT, lưu
    xuống chỉ còn 3.84, và quy ngược lại là 100.045 ₫ — lệch 45 đồng. Không hiện
    thì chủ shop tưởng mình đặt giá đúng 100.000.
  */
  const goiY = useMemo(() => {
    if (!Number.isFinite(usdtNumber) || usdtNumber <= 0) return null;
    const phan: string[] = [formatUsdt(usdtNumber)];
    for (const dv of ['VND', 'CNY', 'USD'] as const) {
      if (dv === unit) continue;
      const so = convertFromUsdt(usdtNumber, dv, rates);
      if (so !== null) phan.push(formatMoney(so, dv));
    }
    return phan.join('  ·  ');
  }, [usdtNumber, unit, rates]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step={unit === 'VND' ? 1 : 0.01}
          inputMode="decimal"
          value={hienThi}
          invalid={invalid}
          placeholder={placeholder}
          className="min-w-0 flex-1"
          onChange={(event) => goVao(event.target.value)}
        />
        {units.length > 1 && (
          <Tabs
            items={units.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
            value={unit}
            onChange={doiDonVi}
          />
        )}
      </div>
      {goiY && (
        <p className="text-xs text-neutral-500">
          {unit === 'USDT' ? goiY : `${t.admin.priceSaved} ${goiY}`}
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
