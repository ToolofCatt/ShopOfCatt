import { describe, expect, it } from 'vitest';
import { calcDiscount, formatUsdt, sumMoney } from './index';

describe('sumMoney', () => {
  it('không để lại rác nhị phân khi cộng dồn', () => {
    // Chuỗi doanh thu 7 ngày có thật đã từng cho ra 94.46000000000001
    const daily = [38, 0, 2, 12, 0, 1, 41.46];
    expect(daily.reduce((a, b) => a + b, 0)).not.toBe(94.46); // cộng thẳng thì sai
    expect(sumMoney(daily)).toBe(94.46); // qua hàm này thì đúng
  });

  it('mảng rỗng = 0', () => {
    expect(sumMoney([])).toBe(0);
  });

  it('làm tròn về đúng 2 chữ số', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([1.005, 1.005])).toBe(2.01);
  });
});

describe('calcDiscount', () => {
  it('giảm theo phần trăm', () => {
    expect(calcDiscount(100, 'PERCENT', 10)).toBe(10);
    expect(calcDiscount(8.5, 'PERCENT', 10)).toBe(0.85);
  });

  it('giảm số tiền cố định', () => {
    expect(calcDiscount(100, 'FIXED', 15)).toBe(15);
  });

  it('KHÔNG BAO GIỜ giảm quá tiền hàng (đơn không thể âm)', () => {
    expect(calcDiscount(10, 'FIXED', 999)).toBe(10);
    expect(calcDiscount(10, 'PERCENT', 100)).toBe(10);
  });

  it('không trả về số âm dù cấu hình sai', () => {
    expect(calcDiscount(10, 'FIXED', -5)).toBe(0);
    expect(calcDiscount(10, 'PERCENT', -20)).toBe(0);
  });

  it('luôn tối đa 2 chữ số thập phân', () => {
    const d = calcDiscount(33.33, 'PERCENT', 33);
    expect(Number.isInteger(d * 100)).toBe(true);
  });
});

describe('formatUsdt', () => {
  it('luôn hiện đúng 2 chữ số thập phân', () => {
    expect(formatUsdt(5)).toBe('5.00 USDT');
    expect(formatUsdt(1234.5)).toBe('1,234.50 USDT');
  });
});
