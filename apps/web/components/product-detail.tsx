'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { BuyBox } from '@/components/buy-box';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

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

  /*
   * Ảnh bìa đứng đầu, rồi tới ảnh phụ theo thứ tự chủ shop đã sắp.
   *
   * Ảnh bìa nằm ở cột `Product.image` chứ không nằm trong bảng `ProductImage`,
   * nên phải ghép ở đây. Lọc rỗng để sản phẩm chưa có ảnh nào thì mảng rỗng và
   * cả khối ảnh biến mất, thay vì để lại một ô xám cao gần 400px.
   */
  const gallery = useMemo(
    () => [product.image, ...product.images.map((item) => item.url)].filter(
      (source): source is string => Boolean(source),
    ),
    [product.image, product.images],
  );
  const [selected, setSelected] = useState(0);

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
      <div className="mt-6 grid gap-x-8 gap-y-6 @3xl:grid-cols-[1fr_380px] @3xl:grid-rows-[auto_1fr] @3xl:items-start">
        <div className="@3xl:col-start-1 @3xl:row-start-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
          {product.shortDescription && (
            <p className="mt-2 text-neutral-500">{product.shortDescription}</p>
          )}

          {gallery.length > 0 && (
            <div className={`mt-6 ${outOfStock ? 'opacity-50 grayscale' : ''}`}>
              {/*
                `max-h` chứ KHÔNG phải `aspect-[…]`, và `object-contain` chứ
                không `object-cover`. Trước đây ô ảnh cố định 16:9 và cắt ảnh
                cho đầy khung: logo hay ảnh hộp sản phẩm bị xén mất trên dưới,
                và khi sản phẩm CHƯA có ảnh thì cái ô xám rỗng cao gần 400px vẫn
                chiếm chỗ, đẩy phần mô tả xuống dưới màn hình đầu tiên.
                Giờ khung co theo ảnh, và không có ảnh thì không có khung.
              */}
              <div className="flex items-center justify-center overflow-hidden rounded-lg bg-neutral-100 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gallery[Math.min(selected, gallery.length - 1)]}
                  alt={product.name}
                  className="max-h-[420px] w-auto max-w-full rounded object-contain"
                />
              </div>

              {gallery.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {gallery.map((source, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={t.product.viewImage(index + 1)}
                      aria-pressed={index === selected}
                      onClick={() => setSelected(index)}
                      className={cn(
                        'h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 bg-neutral-100 transition-colors',
                        index === selected
                          ? 'border-neutral-950'
                          : 'border-transparent hover:border-neutral-300',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={source}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/*
          Hộp mua hàng trải HAI hàng, và hàng thứ hai là `1fr`.

          Trước đây nó chỉ nằm ở hàng 1, nên chiều cao hàng 1 = chiều cao hộp mua
          hàng (~700px) và phần mô tả ở hàng 2 bị đẩy xuống tận đáy hộp đó — nhìn
          như bị bỏ quên, nhất là khi ảnh sản phẩm thấp. Cho hộp trải hai hàng và
          dồn toàn bộ khoảng dư vào hàng 2 (`1fr`) thì mô tả nằm ngay dưới ảnh,
          còn hộp mua hàng vẫn cao như cũ.
        */}
        <div className="@3xl:col-start-2 @3xl:row-start-1 @3xl:row-span-2 @3xl:sticky @3xl:top-24">
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
