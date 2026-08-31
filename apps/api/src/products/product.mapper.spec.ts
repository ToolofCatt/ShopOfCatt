import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { ProductWithVariants, StockCountMap } from './product.mapper';
import { toProductDto } from './product.mapper';

function productFixture(): ProductWithVariants {
  const now = new Date('2026-08-31T00:00:00.000Z');
  return {
    id: 'product-1',
    slug: 'tai-khoan-so',
    name: 'Tài khoản số',
    shortDescription: null,
    description: null,
    currency: 'USDT',
    imageBytes: null,
    thumbnailBytes: null,
    category: 'Tài khoản',
    sortOrder: 0,
    active: true,
    stockDrawMode: 'SEQUENTIAL',
    createdAt: now,
    updatedAt: now,
    variants: [
      {
        id: 'active-variant',
        productId: 'product-1',
        name: 'Đang bán',
        price: new Prisma.Decimal(4.5),
        priceCurrency: 'USDT',
        priceAmount: new Prisma.Decimal(4.5),
        sortOrder: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'inactive-variant',
        productId: 'product-1',
        name: 'Đã ngừng bán',
        price: new Prisma.Decimal(2),
        priceCurrency: 'USDT',
        priceAmount: new Prisma.Decimal(2),
        sortOrder: 1,
        active: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

const counts: StockCountMap = new Map([
  ['active-variant', { available: 3, sold: 7 }],
  ['inactive-variant', { available: 9, sold: 11 }],
]);

describe('toProductDto', () => {
  it('giữ tổng bán trọn đời nhưng không trả loại đã tắt ở API công khai', () => {
    const dto = toProductDto(productFixture(), counts, {
      locale: 'vi',
      publicView: true,
    });

    expect(dto.variants.map((variant) => variant.id)).toEqual(['active-variant']);
    expect(dto.availableStock).toBe(3);
    expect(dto.minPrice).toBe(4.5);
    expect(dto.maxPrice).toBe(4.5);
    expect(dto.sold).toBe(18);
  });

  it('trang quản trị vẫn nhận mọi loại và tổng tồn kho của mọi loại', () => {
    const dto = toProductDto(productFixture(), counts, {
      includeTranslations: true,
    });

    expect(dto.variants.map((variant) => variant.id)).toEqual([
      'active-variant',
      'inactive-variant',
    ]);
    expect(dto.availableStock).toBe(12);
    expect(dto.sold).toBe(18);
  });
});
