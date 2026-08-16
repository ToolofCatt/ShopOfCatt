import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServerCrash } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { ProductDetail } from '@/components/product-detail';
import { ProductViewTracker } from '@/components/product-view-tracker';
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
        /*
         * Giờ `product.image` là URL thật nên thẻ chia sẻ mới dùng được — trước
         * đây nó là data URI và bot mạng xã hội không đọc nổi, phải bỏ hẳn.
         * Vẫn kiểm tiền tố http để phòng cấu hình thiếu API_PUBLIC_URL: khi đó
         * địa chỉ sinh ra là đường dẫn tương đối, bot bên ngoài không mở được.
         */
        ...(product.image?.startsWith('http') ? { images: [product.image] } : {}),
      },
      alternates: { canonical: `/products/${product.slug}` },
    };
  } catch {
    // Sản phẩm không tồn tại → để notFound() ở component xử lý, metadata để trống.
    return {};
  }
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ProductViewTracker productId={product.id} />
      <ProductDetail product={product} />
    </div>
  );
}
