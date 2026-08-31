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
  renderDepositCancelled,
  renderDepositInstructions,
  renderDepositMenu,
  renderDepositMethodChooser,
} from './wallet-view';

const RATES: StoreRatesDto = { vndPerUsdt: 26000, cnyPerUsdt: 7.2, updatedAt: null };

describe('callback ví — codec', () => {
  it('roundtrip đủ các kind mới', () => {
    const cases: BotCallback[] = [
      { kind: 'account' },
      { kind: 'depositMenu' },
      { kind: 'depositAmount', vnd: 50_000 },
      { kind: 'depositMethod', vnd: 50_000, method: 'crypto_bep20' },
      { kind: 'depositMethod', vnd: 100_000_000, method: 'sepay' },
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
      {
        code: 'NAP-XYZ789',
        vndAmount: 100_000,
        amountUsdt: 3.846153,
        mode: 'SEPAY',
        cryptoNetwork: null,
        cryptoAddress: null,
      },
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
    // Không còn nút kiểm tra — tiền vào là vòng đẩy tự báo cộng ví.
    expect(data).not.toContain('dk:NAP-XYZ789');
    expect(data).toContain('dx:NAP-XYZ789');
  });

  it('bảng chọn cách nạp: mỗi kênh một nút dw:, có nút quay lại', () => {
    const view = renderDepositMethodChooser(
      100_000,
      ['sepay', 'crypto_bep20', 'binance_id'],
      'vi',
    );
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('dw:100000:sp');
    expect(data).toContain('dw:100000:cb');
    expect(data).toContain('dw:100000:bi');
    expect(data).toContain('d'); // quay lại màn nạp
    expect(view.text).toContain('100.000 ₫');
  });

  it('hướng dẫn nạp CRYPTO: địa chỉ + số USDT đủ 6 số lẻ trong <code>, không QR', () => {
    const view = renderDepositInstructions(
      {
        code: 'NAP-CRY001',
        vndAmount: 100_000,
        amountUsdt: 3.8463, // đã lệch bước duy nhất
        mode: 'CRYPTO',
        cryptoNetwork: 'BEP20',
        cryptoAddress: '0xabc',
      },
      null,
      'vi',
      29,
    );
    expect(view.text).toContain('<code>0xabc</code>');
    // Đủ 6 chữ số lẻ — phần lẻ là "chữ ký" nhận diện, không được cắt.
    expect(view.text).toContain('<code>3.846300</code> USDT');
    expect(view.text).toContain('BEP20');
    // Mã nạp hiện để khách đưa cho hỗ trợ — on-chain không có chỗ ghi memo.
    expect(view.text).toContain('NAP-CRY001');
    expect(view.text).toContain('29 phút');
    expect(view.photo ?? null).toBeNull();
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('dx:NAP-CRY001');
  });

  it('hướng dẫn nạp BINANCE_ID: id nhận tiền + mã NAP trong lời nhắn', () => {
    const view = renderDepositInstructions(
      {
        code: 'NAP-BID001',
        vndAmount: 260_000,
        amountUsdt: 10.0001,
        mode: 'BINANCE_ID',
        cryptoNetwork: null,
        cryptoAddress: '123456789',
      },
      null,
      'vi',
      29,
    );
    expect(view.text).toContain('<code>123456789</code>');
    expect(view.text).toContain('<code>10.000100</code> USDT');
    expect(view.text).toContain('NAP-BID001');
    expect(view.photo ?? null).toBeNull();
  });

  it('tin đã cộng ví: số tiền + số dư mới theo ngôn ngữ', () => {
    const view = renderDepositCredited(10, 13.5, 'vi', RATES);
    expect(view.text).toContain('260.000 ₫');
    expect(view.text).toContain('351.000 ₫');
  });

  it('huỷ mã nạp dùng đúng nhãn và quay về luồng nạp/menu', () => {
    const view = renderDepositCancelled('NAP-ABC123', 'vi');
    expect(view.text).toContain('Đã huỷ mã nạp NAP-ABC123');
    expect(view.keyboard.flat().map((button) => button.callback_data)).toEqual(['d', 'h']);
    expect(view.keyboard[0][0].text).toContain('Nạp tiền khác');
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
