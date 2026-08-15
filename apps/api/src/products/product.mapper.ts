import type {
  Prisma,
  Product,
  ProductTranslation,
  ProductVariant,
  ProductVariantTranslation,
} from '@prisma/client';
import {
  TRANSLATABLE_LOCALES,
  type ProductDto,
  type ProductTranslations,
  type ProductVariantDto,
  type TranslatableLocale,
  type VariantTranslations,
} from '@webcatt/shared';
import type { Locale } from '../i18n/locale';
import type { PrismaService } from '../prisma/prisma.service';

export interface StockCounts {
  available: number;
  sold: number;
}

/** Số dòng kho AVAILABLE / SOLD, khoá theo `variantId`. */
export type StockCountMap = Map<string, StockCounts>;

const EMPTY_COUNTS: StockCounts = { available: 0, sold: 0 };

export type VariantWithTranslations = ProductVariant & {
  translations?: ProductVariantTranslation[];
};

export type ProductWithVariants = Product & {
  variants: VariantWithTranslations[];
  translations?: ProductTranslation[];
};

export interface ProductDtoOptions {
  /**
   * Ngôn ngữ hiển thị (endpoint công khai). `vi` → giữ nguyên bản gốc;
   * `en`/`zh` → thay thế từng trường khi có bản dịch không rỗng.
   */
  locale?: Locale;
  /**
   * Trang quản trị: luôn trả bản gốc tiếng Việt kèm toàn bộ bản dịch.
   * Bật cờ này thì `locale` bị bỏ qua.
   */
  includeTranslations?: boolean;
}

function isTranslatableLocale(value: string): value is TranslatableLocale {
  return (TRANSLATABLE_LOCALES as readonly string[]).includes(value);
}

/** Chỉ thay thế khi bản dịch tồn tại và không rỗng. */
function pick(translated: string | null | undefined, original: string): string {
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated
    : original;
}

function pickNullable(
  translated: string | null | undefined,
  original: string | null,
): string | null {
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated
    : original;
}

function toProductTranslations(rows: ProductTranslation[]): ProductTranslations {
  const map: ProductTranslations = {};
  for (const row of rows) {
    if (!isTranslatableLocale(row.locale)) continue;
    map[row.locale] = {
      name: row.name,
      shortDescription: row.shortDescription ?? '',
      description: row.description ?? '',
      category: row.category ?? '',
    };
  }
  return map;
}

function toVariantTranslations(
  rows: ProductVariantTranslation[],
): VariantTranslations {
  const map: VariantTranslations = {};
  for (const row of rows) {
    if (!isTranslatableLocale(row.locale)) continue;
    map[row.locale] = { name: row.name };
  }
  return map;
}

export function toProductVariantDto(
  variant: VariantWithTranslations,
  counts: StockCounts = EMPTY_COUNTS,
  options: ProductDtoOptions = {},
): ProductVariantDto {
  const rows = variant.translations ?? [];
  const dto: ProductVariantDto = {
    id: variant.id,
    name: variant.name,
    price: Number(variant.price),
    sortOrder: variant.sortOrder,
    active: variant.active,
    availableStock: counts.available,
    sold: counts.sold,
  };

  if (options.includeTranslations) {
    dto.translations = toVariantTranslations(rows);
  } else if (options.locale && options.locale !== 'vi') {
    const row = rows.find((item) => item.locale === options.locale);
    dto.name = pick(row?.name, variant.name);
  }
  return dto;
}

export function toProductDto(
  product: ProductWithVariants,
  stock: StockCountMap,
  options: ProductDtoOptions = {},
): ProductDto {
  const variants = product.variants.map((variant) =>
    toProductVariantDto(variant, stock.get(variant.id) ?? EMPTY_COUNTS, options),
  );

  // Giá hiển thị chỉ tính trên các loại đang bán.
  const activePrices = variants.filter((v) => v.active).map((v) => v.price);
  const minPrice = activePrices.length > 0 ? Math.min(...activePrices) : 0;
  const maxPrice = activePrices.length > 0 ? Math.max(...activePrices) : 0;

  const rows = product.translations ?? [];
  const translated =
    !options.includeTranslations && options.locale && options.locale !== 'vi'
      ? rows.find((row) => row.locale === options.locale)
      : undefined;

  const dto: ProductDto = {
    id: product.id,
    slug: product.slug,
    name: pick(translated?.name, product.name),
    shortDescription: pickNullable(
      translated?.shortDescription,
      product.shortDescription,
    ),
    description: pickNullable(translated?.description, product.description),
    currency: product.currency,
    minPrice,
    maxPrice,
    image: product.image,
    category: pickNullable(translated?.category, product.category),
    sortOrder: product.sortOrder,
    active: product.active,
    availableStock: variants.reduce((sum, v) => sum + v.availableStock, 0),
    sold: variants.reduce((sum, v) => sum + v.sold, 0),
    variants,
    createdAt: product.createdAt.toISOString(),
  };

  if (options.includeTranslations) {
    dto.translations = toProductTranslations(rows);
  }
  return dto;
}

/**
 * Đếm số dòng kho AVAILABLE / SOLD cho một tập loại sản phẩm
 * (một truy vấn groupBy theo `variantId`).
 */
export async function getVariantStockCountMap(
  db: PrismaService | Prisma.TransactionClient,
  variantIds: string[],
): Promise<StockCountMap> {
  const map: StockCountMap = new Map();
  for (const id of variantIds) {
    map.set(id, { available: 0, sold: 0 });
  }
  if (variantIds.length === 0) return map;

  const grouped = await db.stockItem.groupBy({
    by: ['variantId', 'status'],
    where: { variantId: { in: variantIds } },
    _count: { _all: true },
  });
  for (const group of grouped) {
    const entry = map.get(group.variantId);
    if (!entry) continue;
    if (group.status === 'AVAILABLE') entry.available = group._count._all;
    else if (group.status === 'SOLD') entry.sold = group._count._all;
  }
  return map;
}

/** Gom tất cả `variantId` của một danh sách sản phẩm. */
export function collectVariantIds(products: ProductWithVariants[]): string[] {
  return products.flatMap((product) => product.variants.map((v) => v.id));
}

/** Thứ tự hiển thị các loại: sortOrder tăng dần, rồi theo thời điểm tạo. */
export const VARIANT_ORDER_BY: Prisma.ProductVariantOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
];
