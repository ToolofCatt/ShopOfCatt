import { describe, expect, it } from 'vitest';
import {
  matchPayTransfers,
  type BinancePayTransfer,
  type PendingPayPayment,
} from './pay-matcher';

const LUC = new Date('2026-08-17T10:00:00.000Z').getTime();

function don(overrides: Partial<PendingPayPayment> = {}): PendingPayPayment {
  return {
    orderId: 'don-1',
    code: 'DH-AAAAAA',
    expected: 5.0123,
    createdAtMs: LUC,
    ...overrides,
  };
}

function giaoDich(overrides: Partial<BinancePayTransfer> = {}): BinancePayTransfer {
  return {
    transactionId: 'P_AAA',
    amount: 5.0123,
    currency: 'USDT',
    transactionTimeMs: LUC + 60_000,
    receiverBinanceId: '1240006466',
    ...overrides,
  };
}

const KHONG_DUNG = new Set<string>();

describe('matchPayTransfers', () => {
  it('khớp khi đúng số tiền và đến sau khi đặt đơn', () => {
    const kq = matchPayTransfers([don()], [giaoDich()], KHONG_DUNG);
    expect(kq).toEqual([
      { orderId: 'don-1', transactionId: 'P_AAA', amount: 5.0123, by: 'amount' },
    ]);
  });

  it('BỎ QUA tiền RA — chi 5 USDT của chủ shop không được thành đơn của khách', () => {
    const kq = matchPayTransfers([don()], [giaoDich({ amount: -5.0123 })], KHONG_DUNG);
    expect(kq).toEqual([]);
  });

  it('bỏ qua đồng khác USDT', () => {
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ currency: 'BNB' })],
      KHONG_DUNG,
    );
    expect(kq).toEqual([]);
  });

  it('sai số tiền thì không khớp', () => {
    const kq = matchPayTransfers([don()], [giaoDich({ amount: 5.02 })], KHONG_DUNG);
    expect(kq).toEqual([]);
  });

  it('chấp nhận lệch trong sai số cho phép (nửa bước 0.0001)', () => {
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ amount: 5.01233 })],
      KHONG_DUNG,
    );
    expect(kq).toHaveLength(1);
  });

  it('giao dịch CÓ TRƯỚC khi đặt đơn thì không khớp', () => {
    // Đây là hàng rào chặn kiểu "lấy giao dịch cũ của người khác đem đi nhận hàng".
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ transactionTimeMs: LUC - 24 * 3600_000 })],
      KHONG_DUNG,
    );
    expect(kq).toEqual([]);
  });

  it('vẫn nhận giao dịch đến sớm hơn đơn trong khoảng dung sai 10 phút', () => {
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ transactionTimeMs: LUC - 5 * 60_000 })],
      KHONG_DUNG,
    );
    expect(kq).toHaveLength(1);
  });

  it('mã giao dịch đã dùng thì không dùng lại', () => {
    const kq = matchPayTransfers([don()], [giaoDich()], new Set(['P_AAA']));
    expect(kq).toEqual([]);
  });

  it('HAI đơn cùng số tiền, giao dịch không ghi chú → BỎ QUA, không đoán', () => {
    // Số tiền nay đúng bằng giá bán nên hai khách mua cùng sản phẩm chuyển hai
    // khoản giống hệt. Đoán bừa là giao hàng cho người chưa trả.
    const kq = matchPayTransfers(
      [don({ orderId: 'don-1', code: 'DH-AAA' }), don({ orderId: 'don-2', code: 'DH-BBB' })],
      [giaoDich()],
      KHONG_DUNG,
    );
    expect(kq).toEqual([]);
  });

  it('hai đơn cùng số tiền nhưng có GHI CHÚ mã đơn → khớp đúng đơn đó', () => {
    const kq = matchPayTransfers(
      [don({ orderId: 'don-1', code: 'DH-AAA' }), don({ orderId: 'don-2', code: 'DH-BBB' })],
      [giaoDich({ note: 'thanh toan DH-BBB' })],
      KHONG_DUNG,
    );
    expect(kq).toEqual([
      { orderId: 'don-2', transactionId: 'P_AAA', amount: 5.0123, by: 'memo' },
    ]);
  });

  it('ghi chú đúng mã nhưng SAI SỐ TIỀN → không khớp', () => {
    // Ghi chú do người gửi tự nhập nên không được tin một mình.
    const kq = matchPayTransfers(
      [don({ code: 'DH-AAA' })],
      [giaoDich({ note: 'DH-AAA', amount: 1 })],
      KHONG_DUNG,
    );
    expect(kq).toEqual([]);
  });

  it('ghi chú mã đơn không tồn tại → lùi về khớp theo số tiền', () => {
    const kq = matchPayTransfers(
      [don({ code: 'DH-AAA' })],
      [giaoDich({ note: 'DH-KHONG-CO' })],
      KHONG_DUNG,
    );
    expect(kq).toHaveLength(1);
    expect(kq[0].by).toBe('amount');
  });

  it('ghi chú không phân biệt chữ hoa chữ thường', () => {
    const kq = matchPayTransfers(
      [don({ orderId: 'don-1', code: 'DH-AaBb' }), don({ orderId: 'don-2', code: 'DH-ZZZZ' })],
      [giaoDich({ note: 'dh-aabb' })],
      KHONG_DUNG,
    );
    expect(kq).toHaveLength(1);
    expect(kq[0].orderId).toBe('don-1');
    expect(kq[0].by).toBe('memo');
  });

  it('hai đơn cùng số tiền, mỗi giao dịch ghi chú riêng → khớp đúng từng đơn', () => {
    const kq = matchPayTransfers(
      [don({ orderId: 'don-1', code: 'DH-AAA' }), don({ orderId: 'don-2', code: 'DH-BBB' })],
      [
        giaoDich({ transactionId: 'P_A', note: 'DH-AAA' }),
        giaoDich({ transactionId: 'P_B', note: 'DH-BBB' }),
      ],
      KHONG_DUNG,
    );
    expect(kq.map((m) => m.orderId).sort()).toEqual(['don-1', 'don-2']);
    expect(kq.every((m) => m.by === 'memo')).toBe(true);
  });

  it('bỏ qua giao dịch vào Binance ID khác', () => {
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ receiverBinanceId: '9999999' })],
      KHONG_DUNG,
      { receiverBinanceId: '1240006466' },
    );
    expect(kq).toEqual([]);
  });

  it('không có thông tin bên nhận thì vẫn khớp (API không phải lúc nào cũng trả)', () => {
    const kq = matchPayTransfers(
      [don()],
      [giaoDich({ receiverBinanceId: undefined })],
      KHONG_DUNG,
      { receiverBinanceId: '1240006466' },
    );
    expect(kq).toHaveLength(1);
  });

  it('giao dịch không có mã thì bỏ qua', () => {
    const kq = matchPayTransfers([don()], [giaoDich({ transactionId: '' })], KHONG_DUNG);
    expect(kq).toEqual([]);
  });

  it('ưu tiên giao dịch đến trước khi nhiều giao dịch cùng khớp một đơn', () => {
    const kq = matchPayTransfers(
      [don()],
      [
        giaoDich({ transactionId: 'P_SAU', transactionTimeMs: LUC + 300_000 }),
        giaoDich({ transactionId: 'P_TRUOC', transactionTimeMs: LUC + 60_000 }),
      ],
      KHONG_DUNG,
    );
    expect(kq).toEqual([
      { orderId: 'don-1', transactionId: 'P_TRUOC', amount: 5.0123, by: 'amount' },
    ]);
  });
});
