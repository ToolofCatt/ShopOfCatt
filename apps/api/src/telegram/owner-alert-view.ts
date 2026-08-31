import { escapeHtml } from './catalog-view';

export interface OwnerOrderAlertInput {
  code: string;
  customer: string;
  items: readonly { name: string; quantity: number }[];
  total: string;
  createdAt: Date;
}

export interface OwnerLowStockAlertInput {
  productName: string;
  variantName: string;
  available: number;
  threshold: number;
}

const formatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour12: false,
});

function orderLines(order: OwnerOrderAlertInput): string[] {
  const items = order.items.map(
    (item) => `📦 ${escapeHtml(item.name)} × ${item.quantity}`,
  );
  return [
    ...items,
    `💵 Tổng tiền: <b>${escapeHtml(order.total)}</b>`,
    `👤 Khách: ${escapeHtml(order.customer)}`,
    `🧾 Mã đơn: <code>${escapeHtml(order.code)}</code>`,
    `⏰ Thời gian: ${escapeHtml(formatter.format(order.createdAt))}`,
  ];
}

/** Tin chủ shop: không có callback, không thể vô tình tạo/chốt đơn từ chat. */
export function renderOwnerNewOrderAlert(order: OwnerOrderAlertInput): string {
  return ['🟢 <b>ĐƠN HÀNG MỚI!</b>', '', ...orderLines(order)].join('\n');
}

export function renderOwnerStuckOrderAlert(
  order: OwnerOrderAlertInput,
  ageMinutes: number,
): string {
  return [
    '⏳ <b>ĐƠN CHỜ QUÁ LÂU</b>',
    `⚠️ Đã chờ ${Math.max(1, Math.floor(ageMinutes))} phút mà chưa thanh toán.`,
    '',
    ...orderLines(order),
  ].join('\n');
}

export function renderOwnerLowStockAlert(
  stock: OwnerLowStockAlertInput,
): string {
  const state = stock.available <= 0 ? 'HẾT HÀNG' : 'KHO SẮP HẾT';
  return [
    `⚠️ <b>${state}</b>`,
    '',
    `🛍 Sản phẩm: ${escapeHtml(stock.productName)}`,
    `🏷 Loại: ${escapeHtml(stock.variantName)}`,
    `📉 Còn lại: <b>${Math.max(0, stock.available)}</b>`,
    `🔔 Ngưỡng cảnh báo: ${Math.max(0, stock.threshold)}`,
  ].join('\n');
}

export function renderOwnerTestAlert(): string {
  return [
    '✅ <b>KẾT NỐI CẢNH BÁO THÀNH CÔNG</b>',
    '',
    'Bot sẽ gửi vào chat này khi có đơn mới, đơn chờ quá lâu hoặc kho xuống thấp.',
  ].join('\n');
}
