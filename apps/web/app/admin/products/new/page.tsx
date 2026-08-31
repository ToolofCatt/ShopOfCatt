'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { PageHeader } from '@/components/admin/page-header';
import { ProductForm } from '@/components/admin/product-form';
import { Spinner } from '@/components/ui';

export default function AdminNewProductPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin/products"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-950"
      >
        <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
        {t.admin.navProducts}
      </Link>
      <PageHeader title={t.admin.newProductTitle} />
      <Suspense
        fallback={
          <div className="flex justify-center py-24">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        }
      >
        <ProductForm />
      </Suspense>
    </div>
  );
}
