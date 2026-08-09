'use client';

import Link from 'next/link';
import { formatUsdt, type ProductDto } from '@webcatt/shared';
import { ProductVisual } from '@/components/icon-map';
import { Badge } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

export function ProductCard({ product }: { product: ProductDto }) {
  const { t } = useI18n();
  const outOfStock = product.availableStock <= 0;
  // Nhiều loại với giá khác nhau → hiển thị "Từ {giá thấp nhất}".
  const priceLabel =
    product.maxPrice > product.minPrice
      ? t.product.priceFrom(formatUsdt(product.minPrice))
      : formatUsdt(product.minPrice);

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-neutral-400"
    >
      <ProductVisual
        icon={product.icon}
        image={product.image}
        name={product.name}
        className={cn('aspect-[4/3] w-full', outOfStock && 'opacity-50 grayscale')}
        iconClassName="h-10 w-10"
      />

      <div className="flex flex-1 flex-col gap-1">
        {product.category && (
          <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
            {product.category}
          </p>
        )}
        <h3 className="line-clamp-2 font-medium leading-snug text-neutral-950">{product.name}</h3>
        {product.shortDescription && (
          <p className="line-clamp-2 text-sm text-neutral-500">{product.shortDescription}</p>
        )}
      </div>

      <div className="flex items-end justify-between gap-2 border-t border-neutral-100 pt-3">
        <p className="font-semibold tabular-nums text-neutral-950">{priceLabel}</p>
        <div className="flex flex-col items-end gap-1">
          {outOfStock ? (
            <Badge variant="muted">{t.product.outOfStock}</Badge>
          ) : (
            <Badge variant="outline">{t.product.inStockShort(product.availableStock)}</Badge>
          )}
          <span className="text-[11px] text-neutral-400">{t.product.sold(product.sold)}</span>
        </div>
      </div>
    </Link>
  );
}
