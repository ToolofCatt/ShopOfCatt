/**
 * Xuất đơn hàng ra CSV để đối soát và làm sổ sách.
 *
 * Hàm THUẦN để kiểm thử được: thoát ký tự sai một chỗ là cả file lệch cột, mà
 * đây lại là dữ liệu dùng để khai thuế.
 */

export interface OrderCsvRow {
  code: string;
  createdAt: Date;
  paidAt: Date | null;
  status: string;
  /** null = khách Telegram — xuất ô trống, đừng in chữ "null" vào sổ sách. */
  customerEmail: string | null;
  customerCode: number;
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  couponCode: string | null;
  paymentMode: string | null;
  paymentStatus: string | null;
  itemsCount: number;
  products: string;
}

export const ORDER_CSV_HEADERS = [
  'Ma don',
  'Ngay tao',
  'Ngay thanh toan',
  'Trang thai',
  'Email khach',
  'Ma khach',
  'Tien hang',
  'Giam gia',
  'Thanh tien',
  'Tien te',
  'Ma giam gia',
  'Phuong thuc',
  'Trang thai TT',
  'So dong',
  'San pham',
] as const;

/**
 * Thoát một ô theo RFC 4180: bọc nháy kép khi có dấu phẩy, nháy kép, xuống dòng
 * hoặc khoảng trắng đầu/cuối; nháy kép bên trong nhân đôi.
 *
 * Thêm một bước nữa: ô bắt đầu bằng `= + - @` bị Excel hiểu là CÔNG THỨC. Tên
 * sản phẩm do người dùng nhập, nên đây là đường tiêm công thức vào máy chủ shop
 * (CSV injection). Chèn dấu nháy đơn ở đầu để Excel coi là chữ.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Ngày giờ dạng đọc được, theo múi giờ của máy chủ (đã đặt Asia/Ho_Chi_Minh). */
function csvDate(date: Date | null): string {
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function buildOrdersCsv(rows: readonly OrderCsvRow[]): string {
  const lines = [ORDER_CSV_HEADERS.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.code),
        csvCell(csvDate(row.createdAt)),
        csvCell(csvDate(row.paidAt)),
        csvCell(row.status),
        csvCell(row.customerEmail ?? ''),
        csvCell(row.customerCode),
        csvCell(row.subtotal.toFixed(2)),
        csvCell(row.discount.toFixed(2)),
        csvCell(row.total.toFixed(2)),
        csvCell(row.currency),
        csvCell(row.couponCode),
        csvCell(row.paymentMode),
        csvCell(row.paymentStatus),
        csvCell(row.itemsCount),
        csvCell(row.products),
      ].join(','),
    );
  }
  /*
   * BOM UTF-8 ở đầu file: thiếu nó thì Excel trên Windows mở ra "Tiáº¿ng Viá»t".
   * CRLF vì Excel là nơi file này được mở nhiều nhất.
   */
  return `﻿${lines.join('\r\n')}\r\n`;
}
