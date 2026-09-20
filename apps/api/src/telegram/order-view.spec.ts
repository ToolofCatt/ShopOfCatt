import { describe, expect, it } from 'vitest';
import type {
  OrderDetailDto,
  OrderSummaryDto,
  PaymentInfoDto,
  ProductDto,
  ProductVariantDto,
  StoreRatesDto,
} from '@webcatt/shared';
import { encodeCallback, parseCallback, type BotCallback } from './catalog-view';
import { matchDeposits } from '../binance-exchange/deposit-matcher';
import { matchPayTransfers } from '../binance-exchange/pay-matcher';
import { renderDepositInstructions } from './wallet-view';
import {
  orderMoney,
  renderMethodChooser,
  renderOrderDelivered,
  renderOrderList,
  renderOrderView,
  renderPaymentInstructions,
  renderQuantityPicker,
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

function variant(over: Partial<ProductVariantDto> = {}): ProductVariantDto {
  return {
    id: 'v1',
    name: 'Gói chuẩn',
    price: 100_000 / 26_000,
    priceCurrency: 'VND',
    priceAmount: 100_000,
    sortOrder: 0,
    active: true,
    availableStock: 5,
    sold: 0,
    ...over,
  };
}

function product(item = variant()): ProductDto {
  return {
    id: 'p1',
    slug: 'goi-chuan',
    name: 'Sản phẩm thử',
    shortDescription: null,
    description: null,
    currency: 'USDT',
    minPrice: item.price,
    maxPrice: item.price,
    image: null,
    thumbnail: null,
    imageBytes: null,
    thumbnailBytes: null,
    images: [],
    category: 'Test',
    sortOrder: 0,
    active: true,
    stockDrawMode: 'SEQUENTIAL',
    availableStock: item.availableStock,
    sold: 0,
    variants: [item],
    createdAt: '2026-08-23T00:00:00.000Z',
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

describe('renderQuantityPicker', () => {
  it('tồn 5 hiện đủ 1..5, hai nút mỗi hàng và tổng giá neo trên nút 4', () => {
    const item = variant({ availableStock: 5 });
    const view = renderQuantityPicker(product(item), item, 'vi', RATES, 2);
    const buttons = view.keyboard.flat();
    expect(buttons.filter((button) => button.callback_data?.startsWith('q:')).map((button) => button.callback_data))
      .toEqual(['q:v1:1', 'q:v1:2', 'q:v1:3', 'q:v1:4', 'q:v1:5']);
    expect(buttons.find((button) => button.callback_data === 'q:v1:4')?.text)
      .toBe('4 sản phẩm • 400k');
    expect(view.keyboard.slice(0, 3).map((row) => row.length)).toEqual([2, 2, 1]);
    expect(view.text).toContain('Bấm một mức bên dưới để tạo đơn.');
  });

  it('tồn 20 chỉ hiện 1..10 và có đường mua số lượng lớn', () => {
    const item = variant({ availableStock: 20 });
    const view = renderQuantityPicker(product(item), item, 'vi', RATES, 1);
    const data = view.keyboard.flat().map((button) => button.callback_data);
    expect(data.filter((value) => value?.startsWith('q:'))).toHaveLength(10);
    expect(data).toContain('q:v1:10');
    expect(data).not.toContain('q:v1:11');
    expect(data).toContain('s');
  });

  it('tồn 0 không có nút tạo đơn', () => {
    const item = variant({ availableStock: 0 });
    const view = renderQuantityPicker(product(item), item, 'vi', RATES, 1);
    expect(view.keyboard.flat().some((button) => button.callback_data?.startsWith('q:')))
      .toBe(false);
  });
});

describe('renderPaymentInstructions', () => {
  it.each(['vi', 'en', 'zh'] as const)('copyable amount matches production matchers in %s for orders and wallet', lang => {
    for (const mode of ['CRYPTO', 'BINANCE_ID'] as const) {
      const detail = order({ totalAmount: 3.846153 }, {
        mode, cryptoAmount: 3.846153, cryptoNetwork: 'BEP20', cryptoAddress: '0xfixture', binanceId: '123456',
      });
      const views = [
        renderPaymentInstructions(detail, lang, RATES, 15),
        renderDepositInstructions({ code: 'NAP-FIXTURE', vndAmount: 100_000, amountUsdt: 3.846153, mode, cryptoNetwork: 'BEP20', cryptoAddress: '0xfixture' }, null, lang, 15),
      ];
      for (const view of views) {
        const copy = /<code>([0-9]+\.[0-9]{6})<\/code> USDT/.exec(view.text)?.[1];
        expect(copy).toBe('3.846153');
        const amount = Number(copy);
        const matches = mode === 'CRYPTO'
          ? matchDeposits([{ orderId: 'o1', network: 'BEP20', expected: 3.846153, createdAtMs: 1000 }], [{ txId: 'fixture', network: 'BSC', amount, insertTimeMs: 2000, status: 1 }], new Set())
          : matchPayTransfers([{ orderId: 'o1', code: 'DH-ABC123', expected: 3.846153, createdAtMs: 1000 }], [{ transactionId: 'fixture', amount, currency: 'USDT', transactionTimeMs: 2000, note: 'DH-ABC123' }], new Set());
        expect(matches).toHaveLength(1);
        expect(matches[0].orderId).toBe('o1');
      }
    }
  });

  it.each(['vi', 'en', 'zh'] as const)('INITIALIZING does not offer mock confirmation or payment details in %s', lang => {
    const view = renderPaymentInstructions(order({}, { mode: 'INITIALIZING' as PaymentInfoDto['mode'] }), lang, RATES, null);
    expect(view.keyboard.flat().some(b => b.callback_data === 'z:DH-ABC123')).toBe(false);
    expect(view.text).not.toContain('<code>');
    expect(view.text).toMatch(/khởi tạo|initializ|初始化/i);
  });
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
    expect(view.text).toContain('<code>5.000123</code> USDT');
    expect(view.text).toContain('12 phút');
    expect(view.text).toContain('⏳ Đang chờ hệ thống ghi nhận thanh toán.');
    expect(view.photo ?? null).toBeNull();
    const data = view.keyboard.flat().map((b) => b.callback_data);
    // Không còn nút "Tôi đã chuyển" — vòng đẩy tự giao khi tiền vào.
    expect(data).not.toContain('k:DH-ABC123');
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
    expect(view.text).toContain('⏳ Đang chờ hệ thống ghi nhận thanh toán.');
  });

  it('MOCK: có nút xác nhận giả lập, không có nút "tôi đã chuyển"', () => {
    const view = renderPaymentInstructions(order({}, { mode: 'MOCK' }), 'vi', RATES, null);
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('z:DH-ABC123');
    expect(data).not.toContain('k:DH-ABC123');
  });
});

describe('renderOrderDelivered', () => {
  it.each(['vi','en','zh'] as const)('offers exact clipboard text and TXT callback for short deliveries in %s', lang => {
    const detail=order({status:'DELIVERED'});
    detail.items[0].deliveredLines=['mail@example.test|pass','second|pass'];
    const view=renderOrderDelivered(detail,lang);
    expect(view.keyboard.flat()).toContainEqual(expect.objectContaining({copy_text:{text:'mail@example.test|pass\nsecond|pass'}}));
    expect(view.keyboard.flat()).toContainEqual(expect.objectContaining({callback_data:'dt:DH-ABC123'}));
  });
  it('never truncates long credentials into copy buttons',()=>{
    const detail=order({status:'DELIVERED'});detail.items[0].deliveredLines=['X'.repeat(257),'short|exact'];
    const view=renderOrderDelivered(detail,'vi');
    const buttons=view.keyboard.flat() as Array<{copy_text?:{text:string}}>;
    expect(buttons.filter(b=>b.copy_text).map(b=>b.copy_text!.text)).toEqual(['short|exact']);
  });
  it('splits documents above the transport byte limit without losing multibyte key content', () => {
    const key = '🔑'.repeat(2_600_001) + '\nEND-OF-KEY';
    const detail = order({ status: 'DELIVERED' });
    detail.items[0].deliveredLines = [key, 'SECOND'];
    const view = renderOrderDelivered(detail, 'vi');
    expect(view.documents!.length).toBeGreaterThan(1);
    for (const file of view.documents!) expect(Buffer.byteLength(file.text)).toBeLessThanOrEqual(10_000_000);
    expect(view.documents!.map(file => file.text).join('')).toBe('DH-ABC123\n\nKey <bản quyền> – Retail ×1\n' + key + '\nSECOND');
  });

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

  it.each([
    ['vi', '🔄 Kiểm tra giao hàng'],
    ['en', '🔄 Check delivery'],
    ['zh', '🔄 检查发货状态'],
  ] as const)('PAID chỉ có nút kiểm tra giao hàng ở %s', (lang, label) => {
    const view = renderOrderView(order({ status: 'PAID' }, null), lang, RATES, null);
    const check = view.keyboard.flat().find((button) => button.callback_data === 'k:DH-ABC123');
    expect(check?.text).toBe(label);
    expect(view.text).not.toMatch(/Tôi đã chuyển|I have paid|我已付款/);
  });
});

describe('renderMethodChooser / renderOrderList', () => {
  it.each(['vi','en','zh'] as const)('quotes method discount without compounding an existing discount in %s',lang=>{
    const view=renderMethodChooser(order({subtotalAmount:10,discountAmount:1,paymentDiscountAmount:1,paymentDiscountPercent:10,totalAmount:9}),[{method:'binance_pay',discountPercent:10}],lang,null,10,9);
    const buttons=view.keyboard.flat();
    expect(buttons.find(b=>b.callback_data==='m:DH-ABC123:bp')?.text).toContain('−10%');
    expect(buttons.find(b=>b.callback_data==='m:DH-ABC123:bp')?.text).toContain('9.00');
    expect(buttons.some(b=>b.callback_data==='mb:DH-ABC123')).toBe(false);
  });
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

  it('sắp phương thức theo số dư → ngân hàng → Binance → crypto → giả lập', () => {
    const view = renderMethodChooser(
      order(),
      [
        { method: 'mock' },
        { method: 'crypto_trc20' },
        { method: 'binance_pay' },
        { method: 'sepay' },
        { method: 'crypto_bep20' },
        { method: 'binance_id' },
      ],
      'vi',
      RATES,
      10,
      10,
    );
    expect(view.keyboard.flat().map((button) => button.callback_data)).toEqual([
      'mb:DH-ABC123',
      'm:DH-ABC123:sp',
      'm:DH-ABC123:bi',
      'm:DH-ABC123:bp',
      'm:DH-ABC123:cb',
      'm:DH-ABC123:ct',
      'm:DH-ABC123:mk',
      'x:DH-ABC123',
    ]);
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
