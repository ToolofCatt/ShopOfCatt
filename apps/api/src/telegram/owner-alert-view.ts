import { escapeHtml } from './catalog-view';
import { brandEmojiHtml } from './animated-emoji';
import type { SupportChannelDto } from '@webcatt/shared';

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
  supportChannels?: readonly SupportChannelDto[];
  restockNotificationsEnabled?: boolean;
}

export interface CustomerAlertIdentity {
  email: string | null;
  /** Dạng lưu hiện có: "Tên (@username)" hoặc "@username". Không xuất tên thật. */
  telegramName: string;
}

/** Mã đơn không đi vào renderer; danh tính luôn qua maskCustomerIdentity. */
export interface SuccessfulPurchaseAlertInput {
  items: readonly { name: string; quantity: number }[];
  total: string;
  paidAt: Date;
  customerIdentity?: CustomerAlertIdentity;
}

/** Giữ số code point, không cắt giữa emoji và không để tên/miền email lọt ra. */
export function maskCustomerIdentity(identity?: CustomerAlertIdentity): string {
  const email = identity?.email?.trim() ?? '';
  const at = email.indexOf('@');
  if (at > 0 && at === email.lastIndexOf('@') && at < email.length - 1 && !/\s/.test(email)) {
    const points = Array.from(email);
    const visible = Math.min(5, Array.from(email.slice(0, at)).length);
    return points.slice(0, visible).join('') + 'x'.repeat(points.length - visible);
  }
  const name = identity?.telegramName.trim() ?? '';
  const username = /^@([a-zA-Z0-9_]{1,32})$/.exec(name)?.[1]
    ?? / \(@([a-zA-Z0-9_]{1,32})\)$/.exec(name)?.[1];
  if (!username) return 'xxx';
  // Username ngắn vẫn phải che ít nhất một ký tự, không hiện toàn bộ handle.
  const visible = Math.min(3, username.length - 1);
  return '@' + username.slice(0, visible) + 'x'.repeat(username.length - visible);
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
    `👤 <b>Khách hàng:</b> <code>${escapeHtml(maskCustomerIdentity(order.customerIdentity))}</code>`,
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
  const empty = stock.available <= 0;
  const variant = stock.variantName.trim();
  const name = stock.productName + (variant && variant !== 'Mặc định' ? ` (${variant})` : '');
  const channels = stock.supportChannels?.filter(channel => channel.value.trim()) ?? [];
  const telegram = channels.find(channel => /^telegram$/i.test(channel.label.trim()));
  const contact = telegram?.value.trim()
    ?? channels.map(channel => `${channel.label}: ${channel.value}`).join(' • ');
  return [
    empty ? '🔴 <b>THÔNG BÁO HẾT HÀNG</b>' : '⚠️ <b>KHO SẮP HẾT</b>',
    '',
    empty ? '🏷️ Sản phẩm vừa hết hàng:' : '🏷️ Sản phẩm sắp hết hàng:',
    `<b>${escapeHtml(name)}</b>`,
    ...(!empty ? [`📉 Còn lại: <b>${stock.available}</b>`] : []),
    '',
    ...(empty && stock.restockNotificationsEnabled ? ['🚨 Chúng tôi sẽ thông báo khi có lại hàng.'] : []),
    ...(contact ? [`📨 Liên hệ Admin để đặt trước: ${escapeHtml(contact)}`] : []),
  ].join('\n');
}

export function renderOwnerTestAlert(): string {
  return [
    '✅ <b>KẾT NỐI CẢNH BÁO THÀNH CÔNG</b>',
    '',
    'Bot chỉ báo mua thành công sau khi xác nhận thanh toán, thông tin khách được ẩn. Cảnh báo vận hành chỉ gửi vào chat riêng.',
  ].join('\n');
}
