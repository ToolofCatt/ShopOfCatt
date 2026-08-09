import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight, ServerCrash } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import type { ReactNode } from 'react';
import { BuyBox } from '@/components/buy-box';
import { ProductVisual } from '@/components/icon-map';
import { EmptyState, buttonVariants } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';
import { getServerDictionary } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/**
 * Tiêu đề + mô tả riêng cho từng sản phẩm. Không có hàm này thì mọi trang đều
 * mang đúng một tiêu đề "Catt Store": tab trình duyệt, lịch sử, kết quả tìm
 * kiếm và link chia sẻ đều không phân biệt được sản phẩm nào.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = await getServerDictionary();
  try {
    const product = await apiFetch<ProductDto>(`/products/${slug}`, { locale });
    const description =
      product.shortDescription?.trim() ||
      product.description?.trim().slice(0, 160) ||
      undefined;
    return {
      title: product.name,
      description,
      openGraph: {
        type: 'website',
        title: product.name,
        description,
        url: `/products/${product.slug}`,
        ...(product.image ? { images: [product.image] } : {}),
      },
      alternates: { canonical: `/products/${product.slug}` },
    };
  } catch {
    // Sản phẩm không tồn tại → để notFound() ở component xử lý, metadata để trống.
    return {};
  }
}

/** Renders description text: blocks split by blank lines; "- " lines become lists. */
function renderDescription(description: string): ReactNode[] {
  const blocks = description
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length > 0 && lines.every((line) => line.startsWith('- '))) {
      return (
        <ul key={blockIndex} className="list-disc space-y-1.5 pl-5 text-neutral-600">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={blockIndex} className="leading-relaxed text-neutral-600">
        {lines.join(' ')}
      </p>
    );
  });
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale, t } = await getServerDictionary();

  let product: ProductDto;
  try {
    product = await apiFetch<ProductDto>(`/products/${slug}`, { locale });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <EmptyState
          icon={ServerCrash}
          title={t.common.serverDownTitle}
          hint={t.common.connectionError}
          action={
            <a href={`/products/${slug}`} className={buttonVariants({ variant: 'outline' })}>
              {t.common.retry}
            </a>
          }
        />
      </div>
    );
  }

  // Hết hàng khi mọi loại đang bán đều không còn kho (hoặc chưa có loại nào).
  const outOfStock = product.variants
    .filter((variant) => variant.active)
    .every((variant) => variant.availableStock <= 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-neutral-500">
        <Link href="/" className="transition-colors hover:text-neutral-950">
          {t.product.breadcrumbHome}
        </Link>
        {product.category && (
          <>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
            <span>{product.category}</span>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" strokeWidth={1.75} />
        <span className="line-clamp-1 font-medium text-neutral-950">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
          {product.shortDescription && (
            <p className="mt-2 text-neutral-500">{product.shortDescription}</p>
          )}

          <ProductVisual
            icon={product.icon}
            image={product.image}
            name={product.name}
            className={`mt-6 aspect-[16/9] w-full ${outOfStock ? 'opacity-50 grayscale' : ''}`}
            iconClassName="h-16 w-16"
          />

          <section className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold tracking-tight">{t.product.descriptionTitle}</h2>
            {product.description ? (
              renderDescription(product.description)
            ) : (
              <p className="text-neutral-500">{t.product.noDescription}</p>
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-24">
          <BuyBox product={product} />
        </div>
      </div>
    </div>
  );
}
