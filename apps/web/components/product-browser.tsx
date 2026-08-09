'use client';

import { useMemo, useState } from 'react';
import { PackageOpen, Search, SearchX } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { ProductCard } from '@/components/product-card';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/** Vietnamese-aware normalization for diacritic-insensitive search. */
function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

export function ProductBrowser({ products }: { products: ProductDto[] }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const product of products) {
      if (product.category && !seen.includes(product.category)) seen.push(product.category);
    }
    return seen;
  }, [products]);

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeText(query.trim());
    return products.filter((product) => {
      if (category && product.category !== category) return false;
      if (!normalizedQuery) return true;
      const haystack = normalizeText(
        `${product.name} ${product.shortDescription ?? ''} ${product.category ?? ''}`,
      );
      return haystack.includes(normalizedQuery);
    });
  }, [products, query, category]);

  // Cửa hàng chưa có sản phẩm nào ≠ tìm kiếm không ra kết quả.
  // Trường hợp này ẩn luôn ô tìm kiếm và bộ lọc vì chẳng có gì để lọc.
  if (products.length === 0) {
    return (
      <EmptyState
        icon={PackageOpen}
        title={t.home.emptyStoreTitle}
        hint={t.home.emptyStoreHint}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.home.searchPlaceholder}
            aria-label={t.home.searchAria}
            className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-9 pr-3 text-sm text-neutral-950 transition-colors placeholder:text-neutral-400 focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <CategoryChip active={category === null} onClick={() => setCategory(null)}>
            {t.home.allCategories}
          </CategoryChip>
          {categories.map((item) => (
            <CategoryChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {item}
            </CategoryChip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t.home.noResultsTitle}
          hint={t.home.noResultsHint}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'cursor-pointer whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-neutral-950 bg-neutral-950 text-white'
          : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500 hover:text-neutral-950',
      )}
    >
      {children}
    </button>
  );
}
