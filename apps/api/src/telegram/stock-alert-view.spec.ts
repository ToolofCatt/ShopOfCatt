import { describe, expect, it } from 'vitest';
import { parseCallback } from './catalog-view';
import { renderStockAlert, type StockAlertInput } from './stock-alert-view';

const ALERT: StockAlertInput = {
  productId: 'product-1',
  productName: 'ChatGPT <Plus>',
  variantName: '30D & Momo',
  price: 3.852198,
  priceCurrency: 'VND',
  priceAmount: 100_000,
  added: 5,
  total: 9,
  createdAt: new Date('2026-08-31T02:31:00.000Z'),
};

const RATES = { vndPerUsdt: 25_959.2, cnyPerUsdt: 7.1, updatedAt: null };

describe('renderStockAlert', () => {
  it('dựng tin Việt đúng giá neo, escape dữ liệu và nút mở đúng sản phẩm', () => {
    const view = renderStockAlert(ALERT, 'vi', RATES, '@cattstore_shop_bot');

    expect(view.text).toContain('HÀNG MỚI VỀ');
    expect(view.text).toContain('emoji-id="5359726582447487916"');
    expect(view.text).toContain('ChatGPT &lt;Plus&gt; · 30D &amp; Momo');
    expect(view.text).toContain('100.000 ₫');
    expect(view.text).toContain('Vừa thêm: 5');
    expect(view.text).toContain('Tồn kho hiện tại: 9');
    expect(view.text).toContain('@cattstore_shop_bot');
    expect(parseCallback(view.keyboard[0][0].callback_data)).toEqual({
      kind: 'product',
      productId: 'product-1',
      backPage: 1,
    });
  });

  it('đổi nội dung và đơn vị theo ngôn ngữ khách', () => {
    expect(renderStockAlert(ALERT, 'en', RATES, null).text).toContain('BACK IN STOCK');
    expect(renderStockAlert(ALERT, 'en', RATES, null).text).toContain('$3.85');
    expect(renderStockAlert(ALERT, 'zh', RATES, null).text).toContain('商品到货');
    expect(renderStockAlert(ALERT, 'zh', RATES, null).text).toContain('¥27.35');
  });
});
