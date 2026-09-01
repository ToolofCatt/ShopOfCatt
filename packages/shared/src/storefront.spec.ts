import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_PAGE_KINDS,
  createDefaultStorefrontDocument,
  parseStorefrontDocument,
  validateStorefrontDocument,
} from './storefront';

describe('StorefrontDocument', () => {
  it('tạo template trung tính đủ mọi trang và block nghiệp vụ bắt buộc', () => {
    const document = createDefaultStorefrontDocument();
    expect(document.brand.name).toBe('Digital Store');
    expect(Object.keys(document.pages)).toEqual([...STOREFRONT_PAGE_KINDS]);
    expect(validateStorefrontDocument(document)).toEqual({ ok: true, errors: [] });
  });

  it('không cho xóa block nghiệp vụ khỏi một trang', () => {
    const document = createDefaultStorefrontDocument();
    document.pages.checkout.blocks = [];
    const result = validateStorefrontDocument(document);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('page checkout must contain exactly one checkoutPanel');
  });

  it('không cho nhân bản hoặc chuyển block nghiệp vụ sang sai trang', () => {
    const document = createDefaultStorefrontDocument();
    document.pages.home.blocks.push({ id: 'another-products', type: 'productBrowser', props: {} });
    document.pages.login.blocks.push({ id: 'wrong-buy-box', type: 'checkoutPanel', props: {} });
    const errors = validateStorefrontDocument(document).errors.join('\n');
    expect(errors).toContain('page home must contain exactly one productBrowser');
    expect(errors).toContain('page login cannot contain checkoutPanel');
  });

  it('chặn màu thiếu, màu thừa và màu không phải hex', () => {
    const missing = createDefaultStorefrontDocument() as unknown as { theme: { colors: Record<string, string> } };
    delete missing.theme.colors.primary;
    expect(validateStorefrontDocument(missing).errors).toContain('theme color primary is invalid');

    const extra = createDefaultStorefrontDocument() as unknown as { theme: { colors: Record<string, string> } };
    extra.theme.colors.script = 'javascript:alert(1)';
    extra.theme.colors.primary = 'javascript:alert(1)';
    const errors = validateStorefrontDocument(extra).errors;
    expect(errors).toContain('theme color primary is invalid');
    expect(errors).toContain('unknown theme color script');
  });

  it('parser từ chối schemaVersion lạ và cây quá sâu', () => {
    const version = createDefaultStorefrontDocument() as unknown as { schemaVersion: number };
    version.schemaVersion = 999;
    expect(() => parseStorefrontDocument(version)).toThrow(/unsupported schemaVersion/);

    const deep = createDefaultStorefrontDocument();
    const root = { id: 'deep-root', type: 'stack' as const, props: {}, children: [] as typeof deep.pages.home.blocks };
    deep.pages.home.blocks.push(root);
    let cursor = root;
    for (let index = 0; index < 7; index += 1) {
      const child = { id: `deep-${index}`, type: 'stack' as const, props: {}, children: [] };
      cursor.children = [child];
      cursor = child;
    }
    expect(validateStorefrontDocument(deep).errors.some((error) => error.includes('maximum nesting'))).toBe(true);
  });

  it('chặn ID trùng để inspector và drag không chọn nhầm block', () => {
    const document = createDefaultStorefrontDocument();
    document.pages.home.blocks.push({ id: 'home-products', type: 'heading', props: {} });
    expect(validateStorefrontDocument(document).errors).toContain('page home contains duplicate id home-products');
  });

  it('chặn prop lạ và URL ảnh tùy ý, chỉ nhận assetId nội bộ', () => {
    const document = createDefaultStorefrontDocument();
    document.pages.home.blocks.push({ id: 'unsafe-image', type: 'image', props: { src: 'javascript:alert(1)', assetId: 'https://tracker.example/image.png' } });
    const errors = validateStorefrontDocument(document).errors;
    expect(errors).toContain('block unsafe-image contains unknown prop src');
    expect(errors).toContain('block unsafe-image prop assetId is invalid');
  });
});
