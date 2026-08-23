import { describe, expect, it } from 'vitest';
import type {
  AnnouncementDto,
  ProductDto,
  ProductVariantDto,
  StoreRatesDto,
} from '@webcatt/shared';
import {
  encodeCallback,
  escapeHtml,
  htmlToPlainText,
  PAGE_MAX_ITEMS,
  parseCallback,
  productButtonLabel,
  productPriceLabel,
  renderAnnouncement,
  renderProductDetail,
  renderStorefront,
  truncateLabel,
} from './catalog-view';

const RATES: StoreRatesDto = { vndPerUsdt: 26000, cnyPerUsdt: 7.2, updatedAt: null };
const NO_RATES: StoreRatesDto = { vndPerUsdt: 0, cnyPerUsdt: 0, updatedAt: null };

function variant(over: Partial<ProductVariantDto> = {}): ProductVariantDto {
  return {
    id: 'v1',
    name: 'Loại thường',
    price: 2.88,
    priceCurrency: 'VND',
    priceAmount: 75_000,
    sortOrder: 0,
    active: true,
    availableStock: 10,
    sold: 3,
    ...over,
  };
}

function product(over: Partial<ProductDto> = {}): ProductDto {
  const variants = over.variants ?? [variant()];
  return {
    id: 'ckqq1234567890abcdefghijk',
    slug: 'san-pham',
    name: '🔑 Key bản quyền',
    shortDescription: 'Giao ngay sau khi thanh toán',
    description: null,
    currency: 'USDT',
    minPrice: 2.88,
    maxPrice: 2.88,
    image: null,
    thumbnail: null,
    imageBytes: null,
    thumbnailBytes: null,
    images: [],
    category: 'AI',
    sortOrder: 0,
    active: true,
    stockDrawMode: 'SEQUENTIAL',
    availableStock: 10,
    sold: 3,
    variants,
    createdAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

describe('escapeHtml / htmlToPlainText', () => {
  it('escape đủ năm ký tự hiểm', () => {
    expect(escapeHtml(`<b>Hack & "q"'</b>`)).toBe(
      '&lt;b&gt;Hack &amp; &quot;q&quot;&#39;&lt;/b&gt;',
    );
  });

  it('đập phẳng HTML thông báo: thẻ khối thành xuống dòng, thẻ lạ biến mất', () => {
    const out = htmlToPlainText('<p>a</p><ul><li>b</li></ul><script>x</script>');
    expect(out).toContain('a');
    expect(out).toContain('• b');
    expect(out).not.toMatch(/<[^>]*>/);
  });

  it('&amp;lt; không bị giải hai lần thành thẻ giả', () => {
    expect(htmlToPlainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });
});

describe('productPriceLabel', () => {
  it('neo VND tròn nghìn → viết gọn kiểu shop Telegram', () => {
    expect(productPriceLabel(product(), 'vi', RATES)).toBe('75k');
    expect(
      productPriceLabel(
        product({ variants: [variant({ priceAmount: 3_800_000 })] }),
        'vi',
        RATES,
      ),
    ).toBe('3800k');
  });

  it('neo VND lẻ → giữ nguyên định dạng đầy đủ, không làm tròn thành nhãn nói dối', () => {
    expect(
      productPriceLabel(
        product({ variants: [variant({ priceAmount: 77_982 })] }),
        'vi',
        RATES,
      ),
    ).toBe('77.982 ₫');
  });

  it('en → USD, zh → CNY (quy đổi từ USDT vì khác đơn vị neo)', () => {
    const p = product({ variants: [variant({ price: 2 })] });
    expect(productPriceLabel(p, 'en', RATES)).toBe('$2.00');
    expect(productPriceLabel(p, 'zh', RATES)).toBe('¥14.40');
  });

  it('priceFrom chỉ khi maxPrice > minPrice, đủ ba ngôn ngữ', () => {
    const p = product({ minPrice: 2.88, maxPrice: 5 });
    expect(productPriceLabel(p, 'vi', RATES)).toBe('Từ 75k');
    expect(productPriceLabel(p, 'en', RATES)).toMatch(/^From /);
    expect(productPriceLabel(p, 'zh', RATES)).toMatch(/ 起$/);
    expect(productPriceLabel(product(), 'vi', RATES)).toBe('75k');
  });

  it('không loại nào active → lùi về minPrice quy đổi như web', () => {
    const p = product({ variants: [variant({ active: false })], minPrice: 2, maxPrice: 2 });
    expect(productPriceLabel(p, 'vi', RATES)).toBe('52k'); // 2 × 26000
  });

  it('thiếu tỉ giá → hiện USDT, không bịa số', () => {
    const p = product({ variants: [variant({ priceCurrency: 'USDT', priceAmount: 2.88 })] });
    expect(productPriceLabel(p, 'vi', NO_RATES)).toBe('2.88 USDT');
    const khongLoai = product({ variants: [variant({ active: false })], minPrice: 2, maxPrice: 2 });
    expect(productPriceLabel(khongLoai, 'vi', NO_RATES)).toBe('2.00 USDT');
  });
});

describe('productButtonLabel', () => {
  it('đủ ba phần: tên | giá | 📦 tồn kho', () => {
    expect(productButtonLabel(product(), 'vi', RATES)).toBe('🔑 Key bản quyền | 75k | 📦 10');
  });

  it('tồn kho âm hiện 📦 0, không hiện số âm', () => {
    expect(productButtonLabel(product({ availableStock: -2 }), 'vi', RATES)).toMatch(/📦 0$/);
  });

  it('tên toàn emoji dài — cắt theo code point, nhãn vẫn lành và phần giá/kho còn nguyên', () => {
    const name = '🔥'.repeat(80);
    const label = productButtonLabel(product({ name }), 'vi', RATES);
    expect(Array.from(label).length).toBeLessThanOrEqual(62);
    expect((label as string & { isWellFormed(): boolean }).isWellFormed()).toBe(true);
    expect(label).toMatch(/\| 75k \| 📦 10$/);
  });

  it('truncateLabel giữ nguyên chuỗi ngắn, thêm … khi cắt', () => {
    expect(truncateLabel('abc', 5)).toBe('abc');
    expect(truncateLabel('abcdef', 5)).toBe('abcd…');
  });
});

describe('encodeCallback / parseCallback', () => {
  it('roundtrip hai loại callback', () => {
    const c = { kind: 'catalog', page: 2 } as const;
    const p = { kind: 'product', productId: 'ckqq1234567890abcdefghijk', backPage: 3 } as const;
    expect(parseCallback(encodeCallback(c))).toEqual(c);
    expect(parseCallback(encodeCallback(p))).toEqual(p);
  });

  it('callback_data của nút sản phẩm không vượt 64 byte với cuid thật', () => {
    const data = encodeCallback({
      kind: 'product',
      productId: 'ckqq1234567890abcdefghijk',
      backPage: 999_999,
    });
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('rác / quá dài / trang không nguyên dương → null', () => {
    expect(parseCallback(undefined)).toBeNull();
    expect(parseCallback('')).toBeNull();
    expect(parseCallback('x:1')).toBeNull();
    expect(parseCallback('c:0')).toBeNull();
    expect(parseCallback('c:-1')).toBeNull();
    expect(parseCallback('c:1.5')).toBeNull();
    expect(parseCallback('p::1')).toBeNull();
    expect(parseCallback(`p:${'a'.repeat(100)}:1`)).toBeNull();
  });
});

describe('renderStorefront', () => {
  const support = [
    { label: 'Telegram', value: '@cattshop' },
    { label: 'Kênh <tin>', value: 'https://t.me/cattshop' },
  ];

  it('mỗi sản phẩm một hàng nút + hàng "Đơn của tôi", callback đúng dạng', () => {
    const view = renderStorefront([product()], 'vi', RATES, support);
    expect(view.keyboard).toHaveLength(2); // 1 sản phẩm + hàng "Đơn của tôi"
    expect(view.keyboard[0][0].callback_data).toBe('p:ckqq1234567890abcdefghijk:1');
    expect(view.keyboard[1][0].callback_data).toBe('o');
    expect(view.totalPages).toBe(1);
  });

  it('kênh hỗ trợ được escape và nối bằng •; rỗng thì không có dòng liên hệ', () => {
    const view = renderStorefront([product()], 'vi', RATES, support);
    expect(view.text).toContain('Telegram: @cattshop • Kênh &lt;tin&gt;: https://t.me/cattshop');
    const khong = renderStorefront([product()], 'vi', RATES, []);
    expect(khong.text).not.toContain('hỗ trợ');
  });

  it('lời chào tuỳ chỉnh thay câu mặc định và được escape', () => {
    const view = renderStorefront([product()], 'vi', RATES, [], 1, 'Chào <bạn> & mua gì ^^');
    expect(view.text).toContain('Chào &lt;bạn&gt; &amp; mua gì ^^');
    expect(view.text).not.toContain('Chào bạn đã đến với cửa hàng');
    // Rỗng/toàn khoảng trắng → lùi về câu mặc định
    const macDinh = renderStorefront([product()], 'vi', RATES, [], 1, '   ');
    expect(macDinh.text).toContain('Chào bạn đã đến với cửa hàng');
  });

  it('danh sách rỗng → câu báo trống, chỉ còn nút "Đơn của tôi"', () => {
    const view = renderStorefront([], 'vi', RATES, []);
    expect(view.text).toContain('chưa có sản phẩm');
    // Vẫn còn "Đơn của tôi": khách của cửa hàng tạm hết hàng vẫn cần xem key cũ.
    expect(view.keyboard).toHaveLength(1);
    expect(view.keyboard[0][0].callback_data).toBe('o');
  });

  it('phân trang: 35 sản phẩm → 2 trang, hàng điều hướng đúng đầu/cuối, page vượt kẹp về cuối', () => {
    const many = Array.from({ length: PAGE_MAX_ITEMS + 5 }, (_, i) =>
      product({ id: `sp${i}`, name: `Sản phẩm ${i}` }),
    );
    const p1 = renderStorefront(many, 'vi', RATES, []);
    expect(p1.totalPages).toBe(2);
    // 30 nút sản phẩm + hàng điều hướng + hàng "Đơn của tôi"
    expect(p1.keyboard).toHaveLength(PAGE_MAX_ITEMS + 2);
    const nav1 = p1.keyboard[p1.keyboard.length - 2].map((b) => b.callback_data);
    expect(nav1).toEqual(['c:1', 'c:2']); // trang đầu không có "Trang trước"

    const p2 = renderStorefront(many, 'vi', RATES, [], 2);
    const nav2 = p2.keyboard[p2.keyboard.length - 2].map((b) => b.callback_data);
    expect(nav2).toEqual(['c:1', 'c:2']); // trang cuối không có "Trang sau"
    expect(p2.keyboard).toHaveLength(5 + 2);

    const kep = renderStorefront(many, 'vi', RATES, [], 99);
    expect(kep.page).toBe(2);
    expect(p1.text.length).toBeLessThan(4096);
  });

  it('nút của trang 2 mang backPage=2 để quay lại đúng trang', () => {
    const many = Array.from({ length: PAGE_MAX_ITEMS + 1 }, (_, i) =>
      product({ id: `sp${i}` }),
    );
    const p2 = renderStorefront(many, 'vi', RATES, [], 2);
    expect(p2.keyboard[0][0].callback_data).toBe(`p:sp${PAGE_MAX_ITEMS}:2`);
  });
});

describe('renderAnnouncement', () => {
  it('tắt hoặc bật-mà-rỗng → null (đừng gửi tin trống)', () => {
    expect(renderAnnouncement({ active: false, title: 'x', body: 'y' }, 'vi')).toBeNull();
    expect(renderAnnouncement({ active: true, title: '', body: '' }, 'vi')).toBeNull();
  });

  it('body HTML được đập phẳng và escape lại', () => {
    const a: AnnouncementDto = {
      active: true,
      title: 'Khuyến mãi <hot>',
      body: '<p>Giảm 10% & tặng key</p>',
    };
    const out = renderAnnouncement(a, 'vi');
    expect(out).toContain('<b>Thông báo từ Admin:</b>');
    expect(out).toContain('Khuyến mãi &lt;hot&gt;');
    expect(out).toContain('Giảm 10% &amp; tặng key');
    expect(out).not.toContain('<p>');
  });
});

describe('renderProductDetail', () => {
  it('từng loại có giá neo + tồn kho; tổng hết hàng vẫn "Còn 0"; ẩn "Đã bán" khi sold = 0', () => {
    const p = product({
      variants: [
        variant({ name: 'Retail', priceAmount: 250_000, availableStock: 12 }),
        variant({ id: 'v2', name: 'OEM', priceAmount: 180_000, availableStock: 0 }),
      ],
      availableStock: 0,
      sold: 0,
    });
    const { text, keyboard } = renderProductDetail(p, 'vi', RATES, [], 3);
    expect(text).toContain('• <b>Retail</b> — 250.000 ₫ — Còn 12');
    expect(text).toContain('• <b>OEM</b> — 180.000 ₫ — Hết hàng');
    expect(text).toContain('Còn 0');
    expect(text).not.toContain('Đã bán');
    // Nút Mua: CHỈ loại còn hàng (Retail) — OEM hết hàng không chào nút hỏng.
    const data = keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('b:v1:ckqq1234567890abcdefghijk:3');
    expect(data.filter((d) => d.startsWith('b:'))).toHaveLength(1);
    // Nút quay lại luôn ở hàng cuối.
    expect(keyboard[keyboard.length - 1][0].callback_data).toBe('c:3');
  });

  it('tên/mô tả được escape; mô tả 10k ký tự vẫn dưới trần 4096 và kết bằng …', () => {
    const p = product({
      name: '<b>Test & "x" 🔑',
      description: 'Nội dung & <chi tiết> rất dài. '.repeat(400),
    });
    const { text } = renderProductDetail(p, 'vi', RATES, [], 1);
    expect(text).toContain('&lt;b&gt;Test &amp; &quot;x&quot; 🔑');
    expect(text.length).toBeLessThan(4096);
    expect(text).toContain('…');
    expect(text).toContain('&lt;chi tiết&gt;');
  });

  it('sold > 0 → có dòng Đã bán • Còn n', () => {
    const { text } = renderProductDetail(product(), 'vi', RATES, [], 1);
    expect(text).toContain('Đã bán 3 • Còn 10');
  });
});
