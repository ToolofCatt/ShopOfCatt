import { describe, expect, it } from 'vitest';
import {
  renderOwnerLowStockAlert,
  renderSuccessfulPurchaseAlert,
  renderOwnerStuckOrderAlert,
  renderOwnerTestAlert,
} from './owner-alert-view';

const ORDER = {
  code: 'DH-TEST01',
  customer: 'An <admin>',
  items: [{ name: 'ChatGPT & Plus · Momo', quantity: 2 }],
  total: '200.000 ₫',
  createdAt: new Date('2026-08-31T02:31:00.000Z'),
  paidAt: new Date('2026-08-31T03:31:00.000Z'),
};

describe('owner alert views', () => {
  it('chỉ dựng thông báo mua thành công ẩn danh, không lộ khách hoặc mã đơn', () => {
    const text = renderSuccessfulPurchaseAlert(ORDER);
    expect(text).toContain('Đã có khách hàng mua thành công');
    expect(text).not.toContain('🟢');
    expect(text).toContain('emoji-id="5359726582447487916"');
    expect(text).toContain('<b>ChatGPT &amp; Plus · Momo</b> × <b>2</b>');
    expect(text).not.toContain('An &lt;admin&gt;');
    expect(text).not.toContain('DH-TEST01');
    expect(text).toContain('xxx');
    expect(text).toContain('200.000 ₫');
    expect(text).toContain('10:31');
    expect(text).not.toContain('09:31');
  });

  it('phân biệt đơn kẹt, kho thấp và hết kho', () => {
    expect(renderOwnerStuckOrderAlert(ORDER, 17.9)).toContain('Đã chờ 17 phút');
    expect(
      renderOwnerLowStockAlert({
        productName: 'Grok',
        variantName: '30 ngày',
        available: 2,
        threshold: 3,
      }),
    ).toContain('KHO SẮP HẾT');
    expect(
      renderOwnerLowStockAlert({
        productName: 'Grok',
        variantName: '30 ngày',
        available: 0,
        threshold: 3,
      }),
    ).toContain('HẾT HÀNG');
  });

  it('dựng tin thử không chứa thao tác nghiệp vụ', () => {
    const text = renderOwnerTestAlert();
    expect(text).toContain('KẾT NỐI CẢNH BÁO THÀNH CÔNG');
    expect(text).not.toContain('callback');
  });
});
