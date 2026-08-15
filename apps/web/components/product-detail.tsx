'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { BuyBox } from '@/components/buy-box';
import { ProductVisual } from '@/components/icon-map';
import { useI18n } from '@/lib/i18n/client';

/**
 * Thân trang chi tiết sản phẩm — dùng chung giữa trang khách và khung xem trước
 * trong trang quản trị.
 *
 * Tách ra khỏi `app/products/[slug]/page.tsx` (server component tự lấy dữ liệu)
 * để khung xem trước hiển thị ĐÚNG thứ khách sẽ thấy. Nếu chép lại markup, hai
 * bên sẽ lệch nhau ngay lần sửa giao diện đầu tiên và bản xem trước bắt đầu nói dối.
 */

/** Mô tả dạng văn bản: cách hai dòng để tách đoạn, dòng bắt đầu "- " thành gạch đầu dòng. */
export function renderDescription(description: string): ReactNode[] {
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

export function ProductDetail({ product }: { product: ProductDto }) {
  const { t } = useI18n();

  // Hết hàng khi mọi loại đang bán đều không còn kho (hoặc chưa có loại nào).
  const outOfStock = product.variants
    .filter((variant) => variant.active)
    .every((variant) => variant.availableStock <= 0);

  return (
    /*
     * `@container` chứ không phải breakpoint theo màn hình: component này chạy ở
     * hai nơi rộng khác hẳn nhau — trang khách (~1120px) và khung xem trước trong
     * trang quản trị (~380px). Dùng `lg:` thì màn hình rộng là lưới hai cột bật
     * lên kể cả bên trong khung hẹp, và hộp mua hàng đè lên phần mô tả.
     */
    <div className="@container">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-sm text-neutral-500"
      >
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

      {/*
        Thứ tự trong DOM: tiêu đề+ảnh → hộp mua hàng → mô tả.
        Trên màn hẹp đó chính là thứ tự hiển thị, nên khách thấy giá và nút mua
        NGAY, không phải cuộn qua hết mô tả dài mới tới. Từ @3xl trở lên, các ô
        được đặt lại vào lưới hai cột nên bố cục máy tính giữ nguyên như cũ.
      */}
      <div className="mt-6 grid gap-x-8 gap-y-6 @3xl:grid-cols-[1fr_380px] @3xl:items-start">
        <div className="@3xl:col-start-1 @3xl:row-start-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
          {product.shortDescription && (
            <p className="mt-2 text-neutral-500">{product.shortDescription}</p>
          )}

          <ProductVisual
            image={product.image}
            name={product.name}
            className={`mt-6 aspect-[16/9] w-full ${outOfStock ? 'opacity-50 grayscale' : ''}`}
            iconClassName="h-16 w-16"
          />
        </div>

        <div className="@3xl:col-start-2 @3xl:row-start-1 @3xl:sticky @3xl:top-24">
          <BuyBox product={product} />
        </div>

        <section className="space-y-4 @3xl:col-start-1 @3xl:row-start-2">
          <h2 className="text-lg font-semibold tracking-tight">{t.product.descriptionTitle}</h2>
          {product.description ? (
            renderDescription(product.description)
          ) : (
            <p className="text-neutral-500">{t.product.noDescription}</p>
          )}
        </section>
      </div>
    </div>
  );
}
