'use client';

import type { ProductVariantDto } from '@webcatt/shared';
import { usePrices } from '@/lib/prices';
import { Badge } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

export interface VariantSelectorProps {
  variants: ProductVariantDto[];
  selectedId: string | null;
  onSelect: (variant: ProductVariantDto) => void;
}

/** Danh sách loại sản phẩm dạng radio — loại hết hàng bị vô hiệu hóa. */
export function VariantSelector({ variants, selectedId, onSelect }: VariantSelectorProps) {
  const { t } = useI18n();
  const { price } = usePrices();

  return (
    <div className="space-y-2">
      <p id="variant-selector-label" className="text-sm font-medium text-neutral-800">
        {t.product.variantLabel}
      </p>

      <div role="radiogroup" aria-labelledby="variant-selector-label" className="space-y-2">
        {variants.map((variant) => {
          const soldOut = variant.availableStock <= 0;
          const selected = variant.id === selectedId;

          return (
            <button
              key={variant.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={soldOut}
              onClick={() => onSelect(variant)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950',
                soldOut
                  ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-60'
                  : selected
                    ? 'cursor-pointer border-neutral-950 bg-neutral-50'
                    : 'cursor-pointer border-neutral-300 hover:border-neutral-500',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-neutral-950">
                  {variant.name}
                </span>
                <span className="mt-0.5 block text-sm font-semibold tabular-nums text-neutral-950">
                  {price(variant).primary}
                </span>
              </span>

              {soldOut ? (
                <Badge variant="muted">{t.product.outOfStock}</Badge>
              ) : (
                <Badge variant={selected ? 'solid' : 'outline'}>
                  {t.product.inStockShort(variant.availableStock)}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
