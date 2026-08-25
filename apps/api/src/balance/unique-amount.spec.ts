import { describe, expect, it } from 'vitest';
import { pickUniqueUsdt, UNIQUE_GAP_USDT } from './unique-amount';

describe('pickUniqueUsdt — số USDT duy nhất cho mã nạp crypto', () => {
  it('không ai chờ → giữ nguyên số gốc', () => {
    expect(pickUniqueUsdt(3.846153, [])).toBe(3.846153);
  });

  it('đụng khoản chờ → nhích từng bước 0.0001 tới khi cách đủ 0.0002', () => {
    const taken = [3.846153, 3.846253]; // hai khoản chắn liền hai bước đầu
    const chon = pickUniqueUsdt(3.846153, taken);
    expect(chon).not.toBeNull();
    for (const t of taken) {
      expect(Math.abs((chon as number) - t)).toBeGreaterThanOrEqual(
        UNIQUE_GAP_USDT - 1e-9,
      );
    }
  });

  it('gần-trùng trong vùng sai số của matcher cũng tính là đụng', () => {
    // 3.846160 chỉ cách 3.846153 có 0.000007 — một giao dịch sẽ khớp cả hai
    // trong epsilon 0.00005, nên phải né.
    const chon = pickUniqueUsdt(3.846153, [3.84616]);
    expect(Math.abs((chon as number) - 3.84616)).toBeGreaterThanOrEqual(
      UNIQUE_GAP_USDT - 1e-9,
    );
  });

  it('kết quả luôn gọn 6 chữ số lẻ (vừa cột Decimal(18,6))', () => {
    const chon = pickUniqueUsdt(0.123456, [0.123456]) as number;
    expect(chon).toBe(Number(chon.toFixed(6)));
  });

  it('200 bước đều bị chắn → null (từ chối rõ ràng, không tạo mã mù)', () => {
    const taken = Array.from({ length: 220 }, (_, i) =>
      Number((5 + i * 0.0001).toFixed(6)),
    );
    expect(pickUniqueUsdt(5, taken)).toBeNull();
  });
});
