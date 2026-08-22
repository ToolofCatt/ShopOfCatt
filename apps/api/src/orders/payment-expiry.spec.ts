import { describe, expect, it } from 'vitest';

import { tinhHanThanhToan } from './orders.service';

/**
 * Hạn thanh toán quyết định kho bị giữ bao lâu, nên mọi nhánh đều phải có bài
 * kiểm: sai một dấu so sánh là đơn treo giữ kho không nhả.
 */

const PHUT = 60_000;
const TAO = 1_700_000_000_000;

function han(method: Parameters<typeof tinhHanThanhToan>[0]['method'], bayGioMs: number) {
  return tinhHanThanhToan({
    taoLucMs: TAO,
    bayGioMs,
    method,
    phutMacDinh: 30,
    phutNganHang: 10,
  }).getTime();
}

describe('tinhHanThanhToan', () => {
  it('phương thức thường: đúng createdAt + 30 phút', () => {
    for (const m of ['mock', 'binance_pay', 'binance_id', 'crypto_bep20', 'crypto_trc20'] as const) {
      expect(han(m, TAO)).toBe(TAO + 30 * PHUT);
    }
  });

  it('phương thức thường KHÔNG phụ thuộc thời điểm gọi', () => {
    // Gọi lại sau 25 phút vẫn ra đúng mốc cũ — không gia hạn.
    expect(han('crypto_bep20', TAO + 25 * PHUT)).toBe(TAO + 30 * PHUT);
  });

  it('ngân hàng chọn ngay lúc tạo: 10 phút', () => {
    expect(han('sepay', TAO)).toBe(TAO + 10 * PHUT);
  });

  it('ngân hàng chọn giữa đơn: 10 phút tính từ lúc chọn', () => {
    expect(han('sepay', TAO + 5 * PHUT)).toBe(TAO + 15 * PHUT);
  });

  it('ngân hàng KHÔNG vượt được trần 30 phút của đơn', () => {
    // Chọn ở phút 25 thì "bây giờ + 10" = phút 35, nhưng trần là phút 30.
    expect(han('sepay', TAO + 25 * PHUT)).toBe(TAO + 30 * PHUT);
    expect(han('sepay', TAO + 29 * PHUT)).toBe(TAO + 30 * PHUT);
  });

  it('bấm qua lại nhiều lần không cộng dồn thời gian', () => {
    let cao = 0;
    for (let phut = 0; phut < 30; phut += 1) {
      const luc = TAO + phut * PHUT;
      cao = Math.max(cao, han('sepay', luc), han('crypto_trc20', luc));
    }
    expect(cao).toBe(TAO + 30 * PHUT);
  });

  it('đơn đã quá trần thì hạn không bị đẩy về tương lai', () => {
    // Gọi muộn 10 phút sau khi đơn lẽ ra đã hết hạn: vẫn trả mốc quá khứ để
    // `releaseExpiredOrders` nhả kho, chứ không hồi sinh đơn.
    const muon = TAO + 40 * PHUT;
    expect(han('sepay', muon)).toBe(TAO + 30 * PHUT);
    expect(han('binance_id', muon)).toBe(TAO + 30 * PHUT);
  });

  it('tôn trọng cấu hình khác mặc định', () => {
    const r = tinhHanThanhToan({
      taoLucMs: TAO,
      bayGioMs: TAO,
      method: 'sepay',
      phutMacDinh: 60,
      phutNganHang: 3,
    });
    expect(r.getTime()).toBe(TAO + 3 * PHUT);
  });
});
