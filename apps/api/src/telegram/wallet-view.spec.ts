import { describe, expect, it } from 'vitest';
import type { StoreRatesDto } from '@webcatt/shared';
import { encodeCallback, parseCallback, type BotCallback } from './catalog-view';
import { renderMethodChooser } from './order-view';
import type { OrderDetailDto } from '@webcatt/shared';
import {
  DEPOSIT_VND_OPTIONS,
  mainMenuKeyboard,
  matchMenuAction,
  renderDepositCredited,
  renderDepositInstructions,
  renderDepositMenu,
} from './wallet-view';

const RATES: StoreRatesDto = { vndPerUsdt: 26000, cnyPerUsdt: 7.2, updatedAt: null };

describe('callback ví — codec', () => {
  it('roundtrip đủ các kind mới', () => {
    const cases: BotCallback[] = [
      { kind: 'account' },
      { kind: 'depositMenu' },
      { kind: 'depositAmount', vnd: 50_000 },
      { kind: 'depositCheck', code: 'NAP-ABC123' },
      { kind: 'depositCancel', code: 'NAP-ABC123' },
      { kind: 'payBalance', orderCode: 'DH-ABC123' },
    ];
    for (const cb of cases) {
      expect(parseCallback(encodeCallback(cb)), JSON.stringify(cb)).toEqual(cb);
    }
  });

  it('số tiền nạp tự chế ngoài khuôn → null ngay ở codec', () => {
    expect(parseCallback('dn:999')).toBeNull(); // dưới 4 chữ số
    expect(parseCallback('dn:9999999999')).toBeNull(); // quá 9 chữ số
    expect(parseCallback('dn:abc')).toBeNull();
  });
});

describe('menu cố định', () => {
  it('so nhãn trên CẢ BA ngôn ngữ — khách đổi ngôn ngữ app giữa chừng vẫn hiểu', () => {
    expect(matchMenuAction('🛒 Mua hàng')).toBe('shop');
    expect(matchMenuAction('🛒 Shop')).toBe('shop');
    expect(matchMenuAction('💰 充值')).toBe('deposit');
    expect(matchMenuAction('👤 Account')).toBe('account');
    expect(matchMenuAction('  ☎️ Hỗ trợ  ')).toBe('support');
    expect(matchMenuAction('xin chào')).toBeNull();
  });

  it('bàn phím cố định: 2 hàng, is_persistent', () => {
    const kb = mainMenuKeyboard('vi');
    expect(kb.keyboard).toHaveLength(2);
    expect(kb.is_persistent).toBe(true);
    expect(kb.keyboard[0][0].text).toBe('🛒 Mua hàng');
  });
});

describe('màn nạp tiền', () => {
  it('mỗi mức nạp một nút dn:, có hàng quay lại', () => {
    const view = renderDepositMenu('vi', 3.5, RATES);
    const data = view.keyboard.flat().map((b) => b.callback_data);
    for (const row of DEPOSIT_VND_OPTIONS) {
      for (const vnd of row) expect(data).toContain(`dn:${vnd}`);
    }
    expect(view.text).toContain('91.000 ₫'); // số dư 3.5 × 26000
  });

  it('hướng dẫn nạp: số VND + mã NAP bắt buộc + QR đúng nội dung', () => {
    const view = renderDepositInstructions(
      { code: 'NAP-XYZ789', vndAmount: 100_000, amountUsdt: 3.846153 },
      { accountNumber: '007', bank: 'Vietcombank', accountHolder: 'NGUYEN VAN A' },
      'vi',
      9,
    );
    expect(view.text).toContain('100.000 ₫');
    expect(view.text).toContain('NAP-XYZ789');
    expect(view.text).toContain('3.85 USDT');
    expect(view.photo).toContain('qr.sepay.vn');
    expect(view.photo).toContain('NAP-XYZ789');
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('dk:NAP-XYZ789');
    expect(data).toContain('dx:NAP-XYZ789');
  });

  it('tin đã cộng ví: số tiền + số dư mới theo ngôn ngữ', () => {
    const view = renderDepositCredited(10, 13.5, 'vi', RATES);
    expect(view.text).toContain('260.000 ₫');
    expect(view.text).toContain('351.000 ₫');
  });
});

describe('bảng chọn phương thức + số dư', () => {
  function don(): OrderDetailDto {
    return {
      id: 'o1',
      code: 'DH-ABC123',
      status: 'PENDING',
      subtotalAmount: 5,
      discountAmount: 0,
      couponCode: null,
      totalAmount: 5,
      currency: 'USDT',
      createdAt: '2026-08-24T00:00:00.000Z',
      expiresAt: null,
      paidAt: null,
      items: [],
      payment: null,
    };
  }

  it('đủ số dư → nút "trả bằng số dư" đứng ĐẦU', () => {
    const view = renderMethodChooser(don(), [{ method: 'sepay' }], 'vi', RATES, 10, 7);
    expect(view.keyboard[0][0].callback_data).toBe('mb:DH-ABC123');
    expect(view.keyboard[0][0].text).toContain('182.000 ₫'); // số dư 7 USDT
  });

  it('thiếu số dư → không chào nút số dư', () => {
    const view = renderMethodChooser(don(), [{ method: 'sepay' }], 'vi', RATES, 10, 3);
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).not.toContain('mb:DH-ABC123');
  });
});
