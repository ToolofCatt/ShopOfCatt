import { describe, expect, it } from 'vitest';
import { buildOrdersCsv, csvCell, type OrderCsvRow } from './orders-csv';

const row = (patch: Partial<OrderCsvRow> = {}): OrderCsvRow => ({
  code: 'DH-AB12CD',
  createdAt: new Date(2026, 7, 9, 14, 5, 30),
  paidAt: new Date(2026, 7, 9, 14, 7, 0),
  status: 'DELIVERED',
  customerEmail: 'khach@vidu.com',
  customerCode: 12345678,
  subtotal: 9.5,
  discount: 0.95,
  total: 8.55,
  currency: 'USDT',
  couponCode: 'SALE10',
  paymentMode: 'BANK',
  paymentStatus: 'SUCCESS',
  itemsCount: 1,
  products: 'Key Windows 11 Pro',
  ...patch,
});

describe('csvCell', () => {
  it('để nguyên chuỗi đơn giản', () => {
    expect(csvCell('DH-AB12CD')).toBe('DH-AB12CD');
  });

  it('bọc nháy kép khi có dấu phẩy', () => {
    expect(csvCell('Key Windows, ban quyen')).toBe('"Key Windows, ban quyen"');
  });

  it('nhân đôi nháy kép bên trong', () => {
    expect(csvCell('Goi "Pro"')).toBe('"Goi ""Pro"""');
  });

  it('bọc khi có xuống dòng — không cho vỡ hàng', () => {
    expect(csvCell('dong1\ndong2')).toBe('"dong1\ndong2"');
  });

  it('chặn tiêm công thức Excel', () => {
    // Tên sản phẩm do người dùng nhập; Excel sẽ CHẠY ô bắt đầu bằng = + - @
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+84900000000')).toBe("'+84900000000");
    expect(csvCell('-5')).toBe("'-5");
  });

  it('ô rỗng cho null/undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('buildOrdersCsv', () => {
  it('có BOM UTF-8 để Excel đọc đúng tiếng Việt', () => {
    expect(buildOrdersCsv([])).toMatch(/^﻿/);
  });

  it('luôn có dòng tiêu đề dù không có đơn nào', () => {
    const csv = buildOrdersCsv([]);
    expect(csv).toContain('Ma don');
    expect(csv.trimEnd().split('\r\n')).toHaveLength(1);
  });

  it('mỗi đơn một dòng, đúng số cột', () => {
    const csv = buildOrdersCsv([row(), row({ code: 'DH-XYZ999' })]);
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(3); // tiêu đề + 2 đơn
    expect(lines[0].split(',')).toHaveLength(15);
    expect(lines[1].split(',')).toHaveLength(15);
  });

  it('số tiền luôn 2 chữ số thập phân', () => {
    const csv = buildOrdersCsv([row({ subtotal: 9.5, discount: 0, total: 9.5 })]);
    expect(csv).toContain('9.50,0.00,9.50');
  });

  it('đơn chưa thanh toán để trống ô ngày thanh toán', () => {
    const csv = buildOrdersCsv([row({ paidAt: null, couponCode: null })]);
    const line = csv.replace(/^﻿/, '').trimEnd().split('\r\n')[1];
    expect(line.split(',')[2]).toBe('');
  });

  it('tên sản phẩm có dấu phẩy không làm vỡ cột', () => {
    const csv = buildOrdersCsv([row({ products: 'Windows 11, Office 2021' })]);
    const line = csv.replace(/^﻿/, '').trimEnd().split('\r\n')[1];
    expect(line).toContain('"Windows 11, Office 2021"');
  });
});
