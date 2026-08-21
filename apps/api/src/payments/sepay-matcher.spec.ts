import { describe, expect, it } from 'vitest';
import {
  matchSepayTransaction,
  normalizeMemo,
  parseSepayDate,
  type PendingSepayPayment,
  type SepayTransaction,
} from './sepay-matcher';

/**
 * Bộ khớp SePay quyết định có giao hàng hay không, nên mỗi nhánh từ chối phải có
 * một bài kiểm riêng. Đặc biệt là nhánh "chuyển thiếu": cho qua là mất hàng.
 */

const DON: PendingSepayPayment = {
  orderId: 'o1',
  code: 'DH-YWD4UM',
  expectedVnd: 92_000,
};

function tx(patch: Partial<SepayTransaction> = {}): SepayTransaction {
  return {
    id: 1,
    transferType: 'in',
    transferAmount: 92_000,
    content: 'CT DEN:123456 DH-YWD4UM',
    transactionDate: '2026-08-20 15:04:05',
    accountNumber: '0010000000355',
    ...patch,
  };
}

describe('normalizeMemo', () => {
  it('bỏ dấu gạch, khoảng trắng và in hoa', () => {
    expect(normalizeMemo('dh-ywd4um')).toBe('DHYWD4UM');
    expect(normalizeMemo('  DH ywd 4UM ')).toBe('DHYWD4UM');
  });

  it('chuỗi rỗng vẫn ra rỗng, không nổ', () => {
    expect(normalizeMemo('')).toBe('');
  });
});

describe('parseSepayDate', () => {
  it('đọc theo giờ Việt Nam (UTC+7)', () => {
    // 15:04:05 giờ VN = 08:04:05 UTC.
    expect(parseSepayDate('2026-08-20 15:04:05')).toBe(
      Date.UTC(2026, 7, 20, 8, 4, 5),
    );
  });

  it('trả null khi thiếu hoặc sai dạng', () => {
    expect(parseSepayDate(undefined)).toBeNull();
    expect(parseSepayDate('hôm qua')).toBeNull();
  });
});

describe('matchSepayTransaction', () => {
  it('khớp khi đúng mã đơn và đúng số tiền', () => {
    const kq = matchSepayTransaction(tx(), [DON]);
    expect(kq.payment?.orderId).toBe('o1');
    expect(kq.reason).toBeUndefined();
  });

  it('nhận ra mã đơn dù ngân hàng bỏ dấu gạch', () => {
    const kq = matchSepayTransaction(tx({ content: 'CHUYEN TIEN DHYWD4UM' }), [DON]);
    expect(kq.payment?.orderId).toBe('o1');
  });

  it('nhận ra mã đơn viết thường lẫn trong chuỗi dài', () => {
    const kq = matchSepayTransaction(
      tx({ content: 'MBVCB.123456.dh ywd4um.CT tu 0011 den 0022' }),
      [DON],
    );
    expect(kq.payment?.orderId).toBe('o1');
  });

  it('dùng được trường `code` khi SePay tự tách ra', () => {
    const kq = matchSepayTransaction(
      tx({ code: 'DH-YWD4UM', content: 'khong co gi' }),
      [DON],
    );
    expect(kq.payment?.orderId).toBe('o1');
  });

  it('BỎ QUA tiền ra', () => {
    const kq = matchSepayTransaction(tx({ transferType: 'out' }), [DON]);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('khong-phai-tien-vao');
  });

  it('từ chối khi tiền vào tài khoản khác', () => {
    const kq = matchSepayTransaction(tx({ accountNumber: '9999' }), [DON], {
      expectedAccountNumber: '0010000000355',
    });
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('sai-tai-khoan');
  });

  it('bỏ qua phép kiểm tài khoản khi không truyền vào', () => {
    const kq = matchSepayTransaction(tx({ accountNumber: '9999' }), [DON]);
    expect(kq.payment?.orderId).toBe('o1');
  });

  it('KHÔNG khớp khi nội dung không có mã đơn, dù số tiền đúng', () => {
    const kq = matchSepayTransaction(tx({ content: 'chuyen tien mua hang' }), [DON]);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('khong-thay-ma-don');
  });

  it('KHÔNG giao hàng khi khách chuyển THIẾU, và nói rõ thiếu bao nhiêu', () => {
    const kq = matchSepayTransaction(tx({ transferAmount: 90_000 }), [DON]);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('sai-so-tien');
    expect(kq.shortfall).toBe(2_000);
  });

  it('chuyển THỪA cũng không tự khớp — để chủ shop quyết', () => {
    const kq = matchSepayTransaction(tx({ transferAmount: 100_000 }), [DON]);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('sai-so-tien');
    expect(kq.shortfall).toBe(-8_000);
  });

  it('không đoán khi hai đơn cùng khớp nội dung', () => {
    const kq = matchSepayTransaction(tx({ content: 'DH-YWD4UM9' }), [
      DON,
      { orderId: 'o2', code: 'DH-YWD4UM9', expectedVnd: 92_000 },
    ]);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('nhieu-don-cung-khop');
  });

  it('chọn đúng đơn khi có nhiều đơn chờ khác mã', () => {
    const kq = matchSepayTransaction(tx(), [
      { orderId: 'o9', code: 'DH-ZZZZZZ', expectedVnd: 92_000 },
      DON,
    ]);
    expect(kq.payment?.orderId).toBe('o1');
  });

  it('không có đơn nào chờ thì không khớp', () => {
    const kq = matchSepayTransaction(tx(), []);
    expect(kq.payment).toBeNull();
    expect(kq.reason).toBe('khong-thay-ma-don');
  });

  it('thiếu transactionDate vẫn khớp — thời gian không phải điều kiện', () => {
    const kq = matchSepayTransaction(tx({ transactionDate: undefined }), [DON]);
    expect(kq.payment?.orderId).toBe('o1');
  });
});
