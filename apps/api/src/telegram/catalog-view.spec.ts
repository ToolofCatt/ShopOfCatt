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
  renderCategoryProducts,
  renderHub,
  renderLanguageMenu,
  renderProductDetail,
  renderProductDescription,
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
  it('đủ ba phần theo số đông shop bot: tên | giá | 📦 n', () => {
    expect(productButtonLabel(product(), 'vi', RATES)).toBe('🔑 Key bản quyền | 75k | 📦 10');
  });

  it('hết hàng → hậu tố "Hết hàng" thay vì con số', () => {
    expect(productButtonLabel(product({ availableStock: 0 }), 'vi', RATES)).toMatch(/\| Hết hàng$/);
    expect(productButtonLabel(product({ availableStock: -2 }), 'vi', RATES)).toMatch(/\| Hết hàng$/);
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
    const pd = { kind: 'productDescription', productId: 'ckqq1234567890abcdefghijk', backPage: 3 } as const;
    expect(parseCallback(encodeCallback(c))).toEqual(c);
    expect(parseCallback(encodeCallback(p))).toEqual(p);
    expect(parseCallback(encodeCallback(pd))).toEqual(pd);
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

describe('renderHub — tối giản kiểu Panda Shop', () => {
  it('chào ⭐ + số dư trong CHỮ + đủ các nhánh', () => {
    const { text, keyboard } = renderHub('An <x>', 3.5, 'vi', RATES);
    expect(text).toContain('⭐ Catt Store Xin Chào An &lt;x&gt; ⭐');
    expect(text).toContain('💰 Số dư: 91.000 ₫'); // 3.5 × 26000
    const data = keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('c:1'); // Cửa Hàng
    expect(data).toContain('o'); // Đơn hàng
    expect(data).toContain('a'); // Tài khoản
    expect(data).toContain('d'); // Nạp tiền
    expect(data).toContain('s'); // Hỗ trợ
    expect(data).toContain('lg'); // Ngôn ngữ
    // Panda: Cửa Hàng một mình một hàng trên cùng
    expect(keyboard[0][0].callback_data).toBe('c:1');
  });

  it('lời chào tuỳ chỉnh thay câu mặc định và được escape', () => {
    const { text } = renderHub('An', 0, 'vi', RATES, 'Chào <bạn> & mua gì ^^');
    expect(text).toContain('Chào &lt;bạn&gt; &amp; mua gì ^^');
    expect(text).not.toContain('Catt Store Xin Chào');
  });
});

describe('renderStorefront — màn cửa hàng', () => {
  it('MỘT danh mục → vào thẳng danh sách phẳng, không bắt bấm thêm', () => {
    const view = renderStorefront([product()], 'vi', RATES);
    expect(view.keyboard[0][0].callback_data).toBe('p:ckqq1234567890abcdefghijk:1');
    // hàng cuối: quay về hub
    expect(view.keyboard[view.keyboard.length - 1][0].callback_data).toBe('h');
  });

  it('ÍT hàng thì PHẲNG HOÁ dù nhiều danh mục — không bắt khách bấm hai lần', () => {
    const nhieu = [
      product({ id: 'a1', category: 'ChatGPT' }),
      product({ id: 'b1', category: 'Claude' }),
      product({ id: 'c1', category: null }),
    ];
    const view = renderStorefront(nhieu, 'vi', RATES);
    // 3 sản phẩm / 3 danh mục vẫn ra danh sách phẳng — học Piggy/sahasa.
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data.filter((v) => v.startsWith('p:'))).toHaveLength(3);
    expect(data.filter((v) => v.startsWith('ct:'))).toHaveLength(0);
  });

  it('NHIỀU hàng + nhiều danh mục → 3 CỘT chữ HOA không đếm (kiểu Panda)', () => {
    const nhieu = [
      ...Array.from({ length: 20 }, (_, i) => product({ id: `g${i}`, category: 'ChatGPT' })),
      ...Array.from({ length: 15 }, (_, i) => product({ id: `c${i}`, category: 'Claude' })),
      product({ id: 'x1', category: null }),
    ];
    const view = renderStorefront(nhieu, 'vi', RATES);
    expect(view.text).toContain('🛍️ Chọn sản phẩm bên dưới 👇');
    const labels = view.keyboard.flat().map((b) => b.text);
    expect(labels).toContain('CHATGPT');
    expect(labels).toContain('CLAUDE');
    expect(labels).toContain('KHÁC'); // không danh mục → gom vào "Khác"
    // 3 cột: hàng đầu phải có 3 nút danh mục
    expect(view.keyboard[0]).toHaveLength(3);
    const data = view.keyboard.flat().map((b) => b.callback_data);
    expect(data.filter((v) => v.startsWith('ct:'))).toHaveLength(3);
  });

  it('danh sách rỗng → câu báo trống + nút về hub', () => {
    const view = renderStorefront([], 'vi', RATES);
    expect(view.text).toContain('chưa có sản phẩm');
    expect(view.keyboard).toHaveLength(1);
    expect(view.keyboard[0][0].callback_data).toBe('h');
  });

  it('phân trang danh sách phẳng: kẹp biên, điều hướng đúng đầu/cuối', () => {
    const many = Array.from({ length: PAGE_MAX_ITEMS + 5 }, (_, i) =>
      product({ id: `sp${i}`, name: `Sản phẩm ${i}` }),
    );
    const p1 = renderStorefront(many, 'vi', RATES);
    expect(p1.totalPages).toBe(2);
    // 30 nút sản phẩm + hàng điều hướng + hàng về hub
    expect(p1.keyboard).toHaveLength(PAGE_MAX_ITEMS + 2);
    const nav1 = p1.keyboard[p1.keyboard.length - 2].map((b) => b.callback_data);
    expect(nav1).toEqual(['c:1', 'c:2']);

    const p2 = renderStorefront(many, 'vi', RATES, 2);
    expect(p2.keyboard[0][0].callback_data).toBe(`p:sp${PAGE_MAX_ITEMS}:2`);
    const kep = renderStorefront(many, 'vi', RATES, 99);
    expect(kep.page).toBe(2);
    expect(p1.text.length).toBeLessThan(4096);
  });
});

describe('renderCategoryProducts', () => {
  const nhieu = [
    product({ id: 'a1', category: 'ChatGPT', name: 'GPT 1' }),
    product({ id: 'b1', category: 'Claude', name: 'CL 1' }),
  ];

  it('tiêu đề DANH MỤC + nút sản phẩm + quay lại danh mục', () => {
    // sort theo tiếng Việt: ChatGPT (0), Claude (1)
    const view = renderCategoryProducts(nhieu, 1, 'vi', RATES);
    expect(view).not.toBeNull();
    expect(view!.text).toContain('📦 Claude — chọn gói bên dưới 👇');
    expect(view!.keyboard[0][0].callback_data).toBe('p:b1:1');
    expect(view!.keyboard[view!.keyboard.length - 1][0].callback_data).toBe('c:1');
  });

  it('index lạ (admin vừa sửa danh mục) → null để service vẽ lại cửa hàng', () => {
    expect(renderCategoryProducts(nhieu, 9, 'vi', RATES)).toBeNull();
  });
});

describe('renderLanguageMenu', () => {
  it('ba nút ngôn ngữ + về hub', () => {
    const { text, keyboard } = renderLanguageMenu('vi');
    expect(text).toContain('CHỌN NGÔN NGỮ');
    const data = keyboard.flat().map((b) => b.callback_data);
    expect(data).toEqual(['lg:vi', 'lg:en', 'lg:zh', 'h']);
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
    expect(text).toContain('• <b>Retail</b> — 250.000 ₫ — 📦 12');
    expect(text).toContain('• <b>OEM</b> — 180.000 ₫ — Hết hàng');
    // Kiểu Panda: kho/đã bán là dòng ⭐ ở đầu — "Đã bán: 0" vẫn hiện (số thật).
    expect(text).toContain('📦 Tồn kho: 0');
    expect(text).toContain('🔥 Đã bán: 0');
    // Nút Mua: CHỈ loại còn hàng (Retail) — OEM hết hàng không chào nút hỏng.
    const data = keyboard.flat().map((b) => b.callback_data);
    expect(data).toContain('b:v1:ckqq1234567890abcdefghijk:3');
    expect(data.filter((d) => d.startsWith('b:'))).toHaveLength(1);
    // Nút quay lại luôn ở hàng cuối.
    expect(keyboard[keyboard.length - 1][0].callback_data).toBe('c:3');
  });

  it('tên/mô tả được escape; mô tả dài được rút gọn và có nút xem đầy đủ', () => {
    const p = product({
      name: '<b>Test & "x" 🔑',
      description: 'Nội dung & <chi tiết> rất dài. '.repeat(400),
    });
    const { text, keyboard } = renderProductDetail(p, 'vi', RATES, [], 1);
    expect(text).toContain('&lt;b&gt;Test &amp; &quot;x&quot; 🔑');
    expect(text.length).toBeLessThan(4096);
    expect(text).toContain('…');
    expect(text).toContain('&lt;chi tiết&gt;');
    expect(keyboard.flat().some((b) => b.callback_data.startsWith('pd:'))).toBe(true);

    const full = renderProductDescription(p, 'vi', 1);
    expect(full.text.length).toBeLessThan(4096);
    expect(full.text).toContain('Mô tả chi tiết');
    expect(full.keyboard[0][0].callback_data).toContain('p:');
  });

  it('mô tả có nhiều ký tự escape vẫn không vượt trần Telegram', () => {
    const p = product({
      shortDescription: '&'.repeat(1_000),
      description: '<'.repeat(1_000),
    });
    const detail = renderProductDetail(p, 'vi', RATES, [], 1);
    expect(detail.text.length).toBeLessThan(4096);
    expect(detail.keyboard.flat().some((button) => button.callback_data.startsWith('pd:'))).toBe(
      true,
    );
    expect(renderProductDescription(p, 'vi', 1).text.length).toBeLessThan(4096);
  });

  it('đầu trang: 💵 Giá / 📦 Tồn kho / 🔥 Đã bán — icon đa dạng theo yêu cầu chủ shop', () => {
    const { text } = renderProductDetail(product(), 'vi', RATES, [], 1);
    expect(text).toContain('💵 Giá: 75k');
    expect(text).toContain('📦 Tồn kho: 10');
    expect(text).toContain('🔥 Đã bán: 3');
    expect(text).toContain('🛒 Chọn loại muốn mua bên dưới:');
  });

  it('tất cả loại hết hàng → không mời chọn mua và không có nút b:', () => {
    const p = product({
      availableStock: 0,
      variants: [variant({ availableStock: 0 })],
    });
    const { text, keyboard } = renderProductDetail(p, 'vi', RATES, [], 1);
    expect(text).toContain('Sản phẩm hiện đang hết hàng');
    expect(text).not.toContain('Chọn loại muốn mua');
    expect(keyboard.flat().some((button) => button.callback_data.startsWith('b:'))).toBe(false);
  });
});
