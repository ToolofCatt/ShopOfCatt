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
                'flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950',
                soldOut
                  ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400'
                  : selected
                    ? 'cursor-pointer border-neutral-950 bg-neutral-50 shadow-[inset_3px_0_0_#0a0a0a]'
                    : 'cursor-pointer border-neutral-300 bg-white hover:border-neutral-600',
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    selected && !soldOut ? 'border-neutral-950' : 'border-neutral-300',
                  )}
                >
                  {selected && !soldOut && (
                    <span className="h-2 w-2 rounded-full bg-neutral-950" />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      soldOut ? 'text-neutral-500' : 'text-neutral-950',
                    )}
                  >
                    {variant.name}
                  </span>
                  <span className="mt-1 block">
                    {soldOut ? (
                      <Badge variant="muted">{t.product.outOfStock}</Badge>
                    ) : (
                      <Badge variant={selected ? 'solid' : 'outline'}>
                        {t.product.inStockShort(variant.availableStock)}
                      </Badge>
                    )}
                  </span>
                </span>
              </span>

              <span
                className={cn(
                  'shrink-0 text-sm font-semibold tabular-nums',
                  soldOut ? 'text-neutral-500' : 'text-neutral-950',
                )}
              >
                {price(variant).primary}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
