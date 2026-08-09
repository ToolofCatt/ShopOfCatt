import { describe, expect, it } from 'vitest';
import {
  buildVietQrPayload,
  crc16,
  normalizeTransferContent,
  transferContentForOrder,
  usdtToVnd,
} from './vietqr';

/** Lấy giá trị một trường EMVCo ở cấp cao nhất của chuỗi. */
function readField(payload: string, id: string): string | null {
  let i = 0;
  while (i < payload.length - 4) {
    const currentId = payload.slice(i, i + 2);
    const length = Number.parseInt(payload.slice(i + 2, i + 4), 10);
    const value = payload.slice(i + 4, i + 4 + length);
    if (currentId === id) return value;
    i += 4 + length;
  }
  return null;
}

describe('crc16 (CRC-16/CCITT-FALSE)', () => {
  it('khớp vector chuẩn của thuật toán', () => {
    // Vector kiểm thử chính thức: "123456789" → 0x29B1
    expect(crc16('123456789')).toBe('29B1');
  });

  it('luôn trả về 4 ký tự hoa', () => {
    expect(crc16('A')).toMatch(/^[0-9A-F]{4}$/);
    expect(crc16('')).toBe('FFFF');
  });
});

describe('normalizeTransferContent', () => {
  it('bỏ dấu tiếng Việt (ngân hàng hay cắt xén ký tự lạ)', () => {
    expect(normalizeTransferContent('Đơn hàng số')).toBe('Don hang so');
  });

  it('bỏ ký tự đặc biệt, giữ chữ và số', () => {
    expect(normalizeTransferContent('DH-AB12CD#!')).toBe('DHAB12CD');
  });

  it('cắt tối đa 25 ký tự', () => {
    expect(normalizeTransferContent('A'.repeat(40))).toHaveLength(25);
  });
});

describe('transferContentForOrder', () => {
  it('bỏ dấu gạch của mã đơn', () => {
    expect(transferContentForOrder('DH-AB12CD')).toBe('DHAB12CD');
  });
});

describe('usdtToVnd', () => {
  it('làm tròn LÊN để cửa hàng không bị thiếu tiền', () => {
    expect(usdtToVnd(1.5, 26000)).toBe(39000);
    expect(usdtToVnd(0.0001, 26000)).toBe(3);
  });
});

describe('buildVietQrPayload', () => {
  const input = {
    bankBin: '970436', // Vietcombank
    accountNumber: '1234567890',
    amountVnd: 250000,
    content: 'DHAB12CD',
  };

  it('mở đầu đúng định dạng EMVCo và là QR động', () => {
    const payload = buildVietQrPayload(input);
    expect(payload.startsWith('000201')).toBe(true);
    // 01 = Point of Initiation, "12" = có sẵn số tiền
    expect(readField(payload, '01')).toBe('12');
  });

  it('mang đúng tiền tệ, quốc gia và số tiền', () => {
    const payload = buildVietQrPayload(input);
    expect(readField(payload, '53')).toBe('704'); // VND
    expect(readField(payload, '58')).toBe('VN');
    expect(readField(payload, '54')).toBe('250000');
  });

  it('nhúng GUID VietQR, mã ngân hàng và số tài khoản', () => {
    const payload = buildVietQrPayload(input);
    const merchant = readField(payload, '38') ?? '';
    expect(merchant).toContain('A000000727');
    expect(merchant).toContain('970436');
    expect(merchant).toContain('1234567890');
    expect(merchant).toContain('QRIBFTTA');
  });

  it('nhúng nội dung chuyển khoản để đối soát theo mã đơn', () => {
    const payload = buildVietQrPayload(input);
    const additional = readField(payload, '62') ?? '';
    expect(additional).toContain('DHAB12CD');
  });

  it('CRC ở cuối và tự kiểm chứng được', () => {
    const payload = buildVietQrPayload(input);
    expect(payload.slice(-8, -4)).toBe('6304');
    const body = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it('mọi trường có độ dài khai báo đúng (quét lại toàn chuỗi)', () => {
    const payload = buildVietQrPayload(input);
    let i = 0;
    let seen = 0;
    while (i < payload.length) {
      const length = Number.parseInt(payload.slice(i + 2, i + 4), 10);
      expect(Number.isFinite(length)).toBe(true);
      i += 4 + length;
      seen++;
    }
    // Đi hết đúng chuỗi, không thừa không thiếu byte nào
    expect(i).toBe(payload.length);
    expect(seen).toBeGreaterThan(5);
  });

  it('từ chối mã BIN sai', () => {
    expect(() => buildVietQrPayload({ ...input, bankBin: '97043' })).toThrow();
    expect(() => buildVietQrPayload({ ...input, bankBin: 'VCB123' })).toThrow();
  });

  it('từ chối số tài khoản không phải chữ số', () => {
    expect(() =>
      buildVietQrPayload({ ...input, accountNumber: '12-34-56' }),
    ).toThrow();
  });

  it('từ chối số tiền không dương', () => {
    expect(() => buildVietQrPayload({ ...input, amountVnd: 0 })).toThrow();
    expect(() => buildVietQrPayload({ ...input, amountVnd: -5 })).toThrow();
  });
});
