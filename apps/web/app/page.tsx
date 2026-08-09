import { ServerCrash } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { Announcement } from '@/components/announcement';
import { ProductBrowser } from '@/components/product-browser';
import { EmptyState, buttonVariants } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { getServerDictionary } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { locale, t } = await getServerDictionary();

  let products: ProductDto[] | null = null;
  try {
    products = await apiFetch<ProductDto[]>('/products', { locale });
  } catch {
    products = null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Announcement />

      {products === null ? (
        <EmptyState
          icon={ServerCrash}
          title={t.common.serverDownTitle}
          hint={t.common.connectionError}
          action={
            <a href="/" className={buttonVariants({ variant: 'outline' })}>
              {t.common.retry}
            </a>
          }
        />
      ) : (
        <ProductBrowser products={products} />
      )}
    </div>
  );
}
