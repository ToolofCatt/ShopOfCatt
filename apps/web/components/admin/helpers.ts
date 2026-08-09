import {
  formatUsdt,
  type PaymentStatus,
  type ProductDto,
  type TranslatableLocale,
} from '@webcatt/shared';
import type { Dictionary } from '@/lib/i18n';
import type { BadgeVariant } from '@/components/ui';

/** Monochrome badge mapping — emerald reserved for SUCCESS only. */
export const PAYMENT_STATUS_BADGE_VARIANT: Record<PaymentStatus, BadgeVariant> = {
  PENDING: 'outline',
  SUCCESS: 'success',
  FAILED: 'muted',
  EXPIRED: 'muted',
};

/** Plain 2-decimal number (no currency suffix) for stat cards. */
export function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Ô nhập nhiều dòng dùng chung trong trang quản trị. */
export const TEXTAREA_CLASSES =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 transition-colors placeholder:text-neutral-400 focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/10';

/** Ô chọn (select) dùng chung trong trang quản trị. */
export const SELECT_CLASSES =
  'h-10 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-950 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/10';

/**
 * Giá hiển thị của sản phẩm nhiều loại: một mức giá thì hiện thẳng,
 * nhiều mức giá thì hiện "Từ {giá thấp nhất}".
 */
export function formatProductPrice(product: ProductDto, t: Dictionary): string {
  if (product.minPrice === product.maxPrice) return formatUsdt(product.minPrice);
  return t.admin.priceFrom(formatUsdt(product.minPrice));
}

/** Nhãn ngôn ngữ của bản dịch tự động. */
export function localeLabel(locale: TranslatableLocale, t: Dictionary): string {
  return locale === 'en' ? t.admin.localeEn : t.admin.localeZh;
}
