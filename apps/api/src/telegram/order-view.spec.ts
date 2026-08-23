import { describe, expect, it } from 'vitest';
import type {
  OrderDetailDto,
  OrderSummaryDto,
  PaymentInfoDto,
  StoreRatesDto,
} from '@webcatt/shared';
import { encodeCallback, parseCallback, type BotCallback } from './catalog-view';
import {
  orderMoney,
  renderMethodChooser,
  renderOrderDelivered,
  renderOrderList,
  renderOrderView,
  renderPaymentInstructions,
} from './order-view';

const RATES: StoreRatesDto = { vndPerUsdt: 26000, cnyPerUsdt: 7.2, updatedAt: null };

function order(over: Partial<OrderDetailDto> = {}, pay: Partial<PaymentInfoDto> | null = {}): OrderDetailDto {
  return {
    id: 'o1',
    code: 'DH-ABC123',
    status: 'PENDING',
    subtotalAmount: 5,
    discountAmount: 0,
    couponCode: null,
    totalAmount: 5,
    currency: 'USDT',
    createdAt: '2026-08-23T00:00:00.000Z',
    expiresAt: null,
    paidAt: null,
    items: [
      {
        id: 'i1',
        productId: 'p1',
        productSlug: 'sp',
        productName: 'Key <bản quyền>',
        variantName: 'Retail',
        unitPrice: 5,
        quantity: 1,
      },
    ],
    payment: pay === null ? null : ({ mode: 'CRYPTO', status: 'PENDING', ...pay } as PaymentInfoDto),
    ...over,
  };
}

describe('parseCallback — các kind luồng mua', () => {
  it('roundtrip đủ mọi loại callback', () => {
    const cases: BotCallback[] = [
      { kind: 'buy', variantId: 'ckvvvv111', productId: 'ckpppp222', backPage: 2 },
      { kind: 'qty', variantId: 'ckvvvv111', qty: 5 },
      { kind: 'method', orderCode: 'DH-ABC123', method: 'sepay' },
      { kind: 'method', orderCode: 'DH-ABC123', method: 'crypto_bep20' },
      { kind: 'check', orderCode: 'DH-ABC123' },
      { kind: 'cancelOrder', orderCode: 'DH-ABC123' },
      { kind: 'mockConfirm', orderCode: 'DH-ABC123' },
      { kind: 'orders' },
      { kind: 'order', orderCode: 'DH-ABC123' },
    ];
    for (const cb of cases) {
      // encode → parse phải về đúng object ban đầu
      expect(parseCallback(encodeCallback(cb)), JSON.stringify(cb)).toEqual(cb);
    }
  });

  it('số lượng ngoài nút chào (callback tự chế) bị chặn', () => {
    expect(parseCallback('q:ckvvvv111:99')).toBeNull();
    expect(parseCallback('q:ckvvvv111:0')).toBeNull();
  });

  it('mã phương thức lạ → null', () => {
    expect(parseCallback('m:DH-ABC123:xx')).toBeNull();
  });
});

describe('orderMoney', () => {
  it('quy đổi theo ngôn ngữ, thiếu tỉ giá lùi về USDT', () => {
    expect(orderMoney(2, 'vi', RATES)).toBe('52.000 ₫');
    expect(orderMoney(2, 'en', RATES)).toBe('$2.00');
    expect(orderMoney(2, 'vi', { vndPerUsdt: 0, cnyPerUsdt: 0, updatedAt: null })).toBe(
      '2.00 USDT',
    );
  });
});

describe('renderPaymentInstructions', () => {
  it('CRYPTO: địa chỉ trong <code>, số tiền DUY NHẤT, cảnh báo chuyển đúng', () => {
    const view = renderPaymentInstructions(
      order({}, {
        mode: 'CRYPTO',
        cryptoNetwork: 'BEP20',
        cryptoAddress: '0xabc',
        cryptoAmount: 5.000123,
      }),
      'vi',
      RATES,
      12,
    );
    expect(view.text).toContain('<code>0xabc</code>');
    expect(view.text).toContain('5.00 USDT');
    expect(view.text).toContain('12 phút');
    expect(view.photo ?? null).toBeNull();
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('k:DH-ABC123');
    expect(data).toContain('x:DH-ABC123');
  });

  it('SEPAY: số VND đã chốt + nội dung BẮT BUỘC là mã đơn + ảnh QR', () => {
    const view = renderPaymentInstructions(
      order({}, {
        mode: 'SEPAY',
        sepayBank: 'Vietcombank',
        sepayAccountNumber: '007',
        vndAmount: 130000,
        sepayQrUrl: 'https://qr.sepay.vn/img?x=1',
      }),
      'vi',
      RATES,
      9,
      'NGUYEN VAN A',
    );
    expect(view.text).toContain('Vietcombank');
    expect(view.text).toContain('130.000 ₫');
    expect(view.text).toContain('DH-ABC123');
    expect(view.text).toContain('NGUYEN VAN A');
    expect(view.photo).toBe('https://qr.sepay.vn/img?x=1');
  });

  it('MOCK: có nút xác nhận giả lập, không có nút "tôi đã chuyển"', () => {
    const view = renderPaymentInstructions(order({}, { mode: 'MOCK' }), 'vi', RATES, null);
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('z:DH-ABC123');
    expect(data).not.toContain('k:DH-ABC123');
  });
});

describe('renderOrderDelivered', () => {
  it('key nằm trong spoiler + code, tên sản phẩm được escape', () => {
    const view = renderOrderDelivered(
      order({
        status: 'DELIVERED',
        items: [
          {
            id: 'i1',
            productId: 'p1',
            productSlug: 'sp',
            productName: 'Key <bản quyền>',
            variantName: 'Retail',
            unitPrice: 5,
            quantity: 2,
            deliveredLines: ['AAAA-BBBB & x', 'CCCC-DDDD'],
          },
        ],
      }),
      'vi',
    );
    expect(view.text).toContain('<tg-spoiler><code>AAAA-BBBB &amp; x</code></tg-spoiler>');
    expect(view.text).toContain('<tg-spoiler><code>CCCC-DDDD</code></tg-spoiler>');
    expect(view.text).toContain('Key &lt;bản quyền&gt;');
    expect(view.text).toContain('×2');
  });
});

describe('renderOrderView', () => {
  it('PENDING → chính là hướng dẫn thanh toán', () => {
    const view = renderOrderView(
      order({}, { mode: 'CRYPTO', cryptoAddress: '0xabc', cryptoAmount: 5 }),
      'vi',
      RATES,
      5,
    );
    expect(view.text).toContain('<code>0xabc</code>');
  });

  it('EXPIRED → đơn đóng, không còn nút thanh toán', () => {
    const view = renderOrderView(order({ status: 'EXPIRED' }, null), 'vi', RATES, null);
    expect(view.text).toContain('Hết hạn');
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).not.toContain('k:DH-ABC123');
    expect(data).not.toContain('x:DH-ABC123');
  });
});

describe('renderMethodChooser / renderOrderList', () => {
  it('mỗi phương thức một nút + nút huỷ', () => {
    const view = renderMethodChooser(
      order(),
      [{ method: 'sepay' }, { method: 'crypto_bep20' }],
      'vi',
      RATES,
      28,
    );
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toEqual(['m:DH-ABC123:sp', 'm:DH-ABC123:cb', 'x:DH-ABC123']);
    expect(view.text).toContain('130.000 ₫'); // 5 USDT × 26000
  });

  it('danh sách đơn: mỗi đơn một nút, rỗng thì báo trống', () => {
    const summaries: OrderSummaryDto[] = [
      {
        code: 'DH-ABC123',
        status: 'DELIVERED',
        totalAmount: 5,
        currency: 'USDT',
        createdAt: '2026-08-23T00:00:00.000Z',
        itemsCount: 1,
        firstProductName: 'Key',
      },
    ];
    const view = renderOrderList(summaries, 'vi', RATES);
    expect(view.keyboard[0][0].callback_data).toBe('v:DH-ABC123');
    expect(view.keyboard[0][0].text).toContain('DH-ABC123');

    const trong = renderOrderList([], 'vi', RATES);
    expect(trong.text).toContain('chưa có đơn nào');
  });
});
