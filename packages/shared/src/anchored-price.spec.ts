import { describe, expect, it } from 'vitest';

import {
  cheapestAnchored,
  displayPriceAmount,
  floorUsdt,
  formatMoney,
  toUsdtFromCurrency,
  type AnchoredPrice,
  type StoreRatesDto,
} from './index';

/**
 * Giá NEO theo đơn vị chủ shop đã gõ.
 *
 * Điều phải đúng: gõ 100.000 ₫ thì khách Việt thấy ĐÚNG 100.000 ₫ — hôm nay, và
 * cả khi tỉ giá đã trôi. Đây là toàn bộ lý do tồn tại của `priceAmount`.
 */

const RATES: StoreRatesDto = {
  vndPerUsdt: 25959.2,
  cnyPerUsdt: 6.7379,
  updatedAt: '2026-08-22T09:00:00.000Z',
};

/** Dựng một giá neo đúng như máy chủ sẽ lưu. */
function neo(soDaGo: number, donVi: AnchoredPrice['priceCurrency'], rates = RATES): AnchoredPrice {
  const usdt = toUsdtFromCurrency(soDaGo, donVi, rates);
  if (usdt === null) throw new Error('khong doi duoc');
  return { price: floorUsdt(usdt), priceCurrency: donVi, priceAmount: soDaGo };
}

describe('toUsdtFromCurrency', () => {
  it('USDT và USD là 1:1, không cần tỉ giá', () => {
    expect(toUsdtFromCurrency(3.5, 'USDT', null)).toBe(3.5);
    expect(toUsdtFromCurrency(3.5, 'USD', null)).toBe(3.5);
  });

  it('₫ và ¥ chia theo tỉ giá', () => {
    expect(toUsdtFromCurrency(25959.2, 'VND', RATES)).toBeCloseTo(1, 9);
    expect(toUsdtFromCurrency(6.7379, 'CNY', RATES)).toBeCloseTo(1, 9);
  });

  it('không có tỉ giá thì trả null, KHÔNG bịa số', () => {
    expect(toUsdtFromCurrency(100000, 'VND', null)).toBeNull();
    expect(
      toUsdtFromCurrency(100000, 'VND', { ...RATES, vndPerUsdt: 0 }),
    ).toBeNull();
    expect(
      toUsdtFromCurrency(100000, 'CNY', { ...RATES, cnyPerUsdt: -1 }),
    ).toBeNull();
  });
});

describe('floorUsdt', () => {
  it('làm tròn XUỐNG sáu chữ số', () => {
    expect(floorUsdt(3.8525229999)).toBe(3.852522);
    expect(floorUsdt(3.8525221)).toBe(3.852522);
  });

  it('phải là làm tròn xuống, không phải làm tròn gần nhất', () => {
    // 3.8525229 gần 3.852523 hơn, nhưng làm tròn LÊN là số ₫ quy ngược lại vượt
    // quá số đã gõ và khách thấy 100.001 ₫.
    expect(floorUsdt(3.8525229)).not.toBe(3.852523);
  });
});

describe('displayPriceAmount', () => {
  it('khách xem đúng đơn vị neo ⇒ nguyên con số đã gõ', () => {
    const g = neo(100000, 'VND');
    expect(displayPriceAmount(g, 'VND', RATES)).toEqual({
      amount: 100000,
      currency: 'VND',
    });
  });

  it('số ₫ hiện ra ĐÚNG BẰNG số tròn đã gõ', () => {
    for (const so of [50000, 99000, 100000, 149000, 250000, 1000000]) {
      expect(formatMoney(displayPriceAmount(neo(so, 'VND'), 'VND', RATES).amount, 'VND')).toBe(
        `${so.toLocaleString('vi-VN')} ₫`,
      );
    }
  });

  it('TỈ GIÁ TRÔI mà số ₫ vẫn đúng — đây là điểm của việc neo', () => {
    const g = neo(100000, 'VND');
    // Tỉ giá tăng 3%: chủ shop không sửa gì, khách Việt vẫn thấy 100.000 ₫.
    const moi: StoreRatesDto = { ...RATES, vndPerUsdt: RATES.vndPerUsdt * 1.03 };
    expect(displayPriceAmount(g, 'VND', moi).amount).toBe(100000);
    // Còn giá USD thì PHẢI đổi — neo theo ₫ nghĩa là để giá đô trôi.
    const cu = displayPriceAmount(g, 'USD', RATES).amount;
    const sau = displayPriceAmount({ ...g, price: floorUsdt(100000 / moi.vndPerUsdt) }, 'USD', moi)
      .amount;
    expect(sau).toBeLessThan(cu);
  });

  it('khách xem đơn vị khác ⇒ quy đổi từ USDT', () => {
    const g = neo(100000, 'VND');
    // Không ghi cứng con số: nó phụ thuộc tỉ giá, và ghi cứng là bài kiểm sai
    // ngay khi ai đó sửa RATES. Điều cần kiểm là quy đổi đi đúng qua `price`.
    expect(displayPriceAmount(g, 'USD', RATES).amount).toBe(g.price);
    expect(displayPriceAmount(g, 'CNY', RATES).amount).toBeCloseTo(
      g.price * RATES.cnyPerUsdt,
      9,
    );
    // Và số đô đó phải xấp xỉ số ₫ chia tỉ giá — không tròn, đúng như dự kiến.
    expect(g.price).toBeCloseTo(100000 / RATES.vndPerUsdt, 5);
    expect(Number.isInteger(g.price)).toBe(false);
  });

  it('neo USDT thì khách Việt thấy số quy đổi như cũ', () => {
    const g = neo(3.5, 'USDT');
    expect(displayPriceAmount(g, 'VND', RATES).amount).toBeCloseTo(3.5 * 25959.2, 2);
  });

  it('không có tỉ giá cho đơn vị khách xem ⇒ lùi về USDT, không bịa số', () => {
    const g = neo(3.5, 'USDT');
    expect(displayPriceAmount(g, 'VND', null)).toEqual({ amount: 3.5, currency: 'USDT' });
  });

  it('tổng nhiều món vẫn ra số tròn sau khi làm tròn lên', () => {
    // Tổng đơn được tính bằng USDT rồi mới quy sang ₫ — chỗ này chứng minh việc
    // dùng sáu chữ số + Math.ceil giữ được số tròn cho tới tận trang thanh toán.
    const g = neo(100000, 'VND');
    for (const sl of [1, 2, 3, 5, 10]) {
      const vnd = Math.ceil(g.price * sl * RATES.vndPerUsdt);
      expect(vnd).toBe(100000 * sl);
    }
  });
});

describe('cheapestAnchored', () => {
  const a = { ...neo(100000, 'VND'), active: true };
  const b = { ...neo(3.5, 'USDT'), active: true };
  const tat = { ...neo(1, 'USDT'), active: false };

  it('lấy loại rẻ nhất theo USDT', () => {
    expect(cheapestAnchored([a, b])).toBe(b);
  });

  it('bỏ qua loại đang tắt, kể cả khi nó rẻ nhất', () => {
    expect(cheapestAnchored([a, b, tat])).toBe(b);
  });

  it('không có loại nào đang bán ⇒ null', () => {
    expect(cheapestAnchored([tat])).toBeNull();
    expect(cheapestAnchored([])).toBeNull();
  });
});
