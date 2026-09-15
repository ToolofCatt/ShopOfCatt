import { describe, expect, it } from 'vitest';
import {
  renderOwnerLowStockAlert,
  renderSuccessfulPurchaseAlert,
  renderOwnerStuckOrderAlert,
  renderOwnerTestAlert,
  maskCustomerIdentity,
} from './owner-alert-view';

const ORDER = {
  code: 'DH-TEST01',
  customer: 'An <admin>',
  items: [{ name: 'ChatGPT & Plus · Momo', quantity: 2 }],
  total: '200.000 ₫',
  createdAt: new Date('2026-08-31T02:31:00.000Z'),
  paidAt: new Date('2026-08-31T03:31:00.000Z'),
  customerIdentity: { email: 'cattab@example.test', telegramName: '' },
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
    expect(text).toContain(`<code>catta${'x'.repeat(ORDER.customerIdentity.email.length - 5)}</code>`);
    expect(text).not.toContain('example.test');
    expect(text).toContain('200.000 ₫');
    expect(text).toContain('10:31');
    expect(text).not.toContain('09:31');
  });

  it('giữ @ và ba ký tự username Telegram, che đúng số ký tự còn lại', () => {
    const text = renderSuccessfulPurchaseAlert({ ...ORDER, customerIdentity: { email: null, telegramName: 'Tên thật (@abcdefg)' } });
    expect(text).toContain('<code>@abcxxxx</code>');
    expect(text).not.toContain('Tên thật');
    expect(text).not.toContain('abcdefg');
  });

  it('tin hết hàng gộp sản phẩm và loại, dùng hỗ trợ của shop và không hiện ngưỡng', () => {
    const text = renderOwnerLowStockAlert({
      productName: 'ChatGPT Plus', variantName: 'Momo', available: 0, threshold: 3,
      supportChannels: [{ label: 'Telegram', value: '@shop_support' }], restockNotificationsEnabled: true,
    });
    expect(text).toContain('THÔNG BÁO HẾT HÀNG');
    expect(text).toContain('ChatGPT Plus (Momo)');
    expect(text).toContain('Chúng tôi sẽ thông báo khi có lại hàng.');
    expect(text).toContain('Liên hệ Admin để đặt trước: @shop_support');
    expect(text).not.toContain('Ngưỡng');
    expect(text).not.toContain('Còn lại:');
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

  it('che phần còn lại đúng độ dài, không xuất tên thật hoặc link username', () => {
    const email = 'cattab@example.test';
    expect(maskCustomerIdentity({email, telegramName:''})).toHaveLength(email.length);
    expect(maskCustomerIdentity({email:'ab@example.test',telegramName:''})).toBe('ab'+'x'.repeat(13));
    expect(maskCustomerIdentity({email:null,telegramName:'@abcde'})).toBe('@abcxx');
    expect(maskCustomerIdentity({email:null,telegramName:'@ab'})).toBe('@ax');
    expect(maskCustomerIdentity({email:null,telegramName:'Tên thật'})).toBe('xxx');
    expect(maskCustomerIdentity({email:'invalid',telegramName:'Display (not a handle)'})).toBe('xxx');
    const unicode='🐱abcdmore@example.test';
    expect(Array.from(maskCustomerIdentity({email:unicode,telegramName:''}))).toHaveLength(Array.from(unicode).length);
  });

  it('không hứa báo lại nếu đã tắt thông báo hàng mới; escape tên và liên hệ', () => {
    const input = {productName:'<script>Test</script>',variantName:'Mặc định',available:0,threshold:3,
      supportChannels:[{label:'Telegram',value:'<b>@support</b>'}],restockNotificationsEnabled:false};
    const text = renderOwnerLowStockAlert(input);
    expect(text).not.toContain('Chúng tôi sẽ thông báo');
    expect(text).not.toContain('Mặc định');
    expect(text).toContain('&lt;script&gt;');
    expect(text).toContain('&lt;b&gt;@support&lt;/b&gt;');
    expect(text).not.toContain('Ngưỡng');
    const low = renderOwnerLowStockAlert({...input, available:2});
    expect(low).toContain('Còn lại: <b>2</b>');
    expect(low).not.toContain('Ngưỡng');
    expect(renderOwnerLowStockAlert({...input,supportChannels:[]})).not.toContain('Liên hệ Admin');
  });

  it('dựng tin thử không chứa thao tác nghiệp vụ', () => {
    const text = renderOwnerTestAlert();
    expect(text).toContain('KẾT NỐI CẢNH BÁO THÀNH CÔNG');
    expect(text).not.toContain('callback');
  });
});
