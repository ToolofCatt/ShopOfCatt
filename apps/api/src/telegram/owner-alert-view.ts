import { escapeHtml } from './catalog-view';
import { brandEmojiHtml } from './animated-emoji';

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

/** Không nhận danh tính hoặc mã đơn: tin thanh toán không thể làm lộ khách. */
export interface SuccessfulPurchaseAlertInput {
  items: readonly { name: string; quantity: number }[];
  total: string;
  paidAt: Date;
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

function itemLines(items: SuccessfulPurchaseAlertInput['items']): string[] {
  return items.map((item) => {
    const trimmedName = item.name.trim();
    // Tên do chủ shop tự đặt icon ở đầu phải được tôn trọng; chỉ dùng hộp hàng
    // làm fallback khi không nhận ra logo hãng và tên cũng chưa có icon riêng.
    const hasLeadingEmoji = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u.test(
      trimmedName,
    );
    const icon = brandEmojiHtml(trimmedName) || (hasLeadingEmoji ? '' : '📦 ');
    return `${icon}<b>${escapeHtml(trimmedName)}</b> × <b>${item.quantity}</b>`;
  });
}

function orderLines(order: OwnerOrderAlertInput): string[] {
  return [
    ...itemLines(order.items),
    `💰 <b>Tổng tiền:</b> ${escapeHtml(order.total)}`,
    '👤 <b>Khách hàng:</b> xxx',
    `⏰ <b>Thời gian:</b> ${escapeHtml(formatter.format(order.createdAt))}`,
  ];
}

/** Chỉ gọi cho đơn đã được xác nhận thanh toán, không dùng createdAt làm thời gian mua. */
export function renderSuccessfulPurchaseAlert(order: SuccessfulPurchaseAlertInput): string {
  return [
    '✅ <b>Đã có khách hàng mua thành công</b>', '',
    ...itemLines(order.items),
    `💰 <b>Tổng tiền:</b> ${escapeHtml(order.total)}`,
    '👤 <b>Khách hàng:</b> xxx',
    `⏰ <b>Thời gian:</b> ${escapeHtml(formatter.format(order.paidAt))}`,
  ].join('\n');
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
    'Bot chỉ báo mua thành công sau khi xác nhận thanh toán, thông tin khách được ẩn. Cảnh báo vận hành chỉ gửi vào chat riêng.',
  ].join('\n');
}
