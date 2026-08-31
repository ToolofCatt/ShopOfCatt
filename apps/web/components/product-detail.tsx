'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  PackageX,
  ShoppingBag,
} from 'lucide-react';
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

    // Seed và nội dung admin thường viết "Tiêu đề:" rồi mới tới các gạch đầu
    // dòng. Ghép cả block thành một câu làm dấu "-" nằm giữa đoạn rất khó đọc.
    if (lines.length > 1 && lines.slice(1).every((line) => line.startsWith('- '))) {
      return (
        <div key={blockIndex} className="space-y-2">
          <p className="font-medium text-neutral-900">{lines[0]}</p>
          <ul className="list-disc space-y-1.5 pl-5 leading-7 text-neutral-600">
            {lines.slice(1).map((line, lineIndex) => (
              <li key={lineIndex}>{line.slice(2)}</li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <p key={blockIndex} className="leading-7 text-neutral-600">
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
  /** Rê chuột vào khung ảnh thì dừng chạy tự động — đang xem thì đừng cướp ảnh. */
  const [paused, setPaused] = useState(false);
  /**
   * Người dùng có bật "giảm chuyển động" trong hệ điều hành hay không.
   *
   * Đọc trong effect chứ không đọc thẳng khi render: `matchMedia` không tồn tại
   * lúc render phía máy chủ, và giá trị máy chủ đoán ra cũng sẽ lệch với máy
   * khách gây cảnh báo hydrate.
   */
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  /*
   * Tự chuyển ảnh mỗi 3 giây, tuần tự, quay vòng.
   *
   * Dùng `setTimeout` phụ thuộc `selected` chứ không phải `setInterval`: bấm
   * chọn ảnh bằng tay là hẹn giờ đặt lại từ đầu, nếu không ảnh vừa bấm có thể
   * bị nhảy sang ảnh khác chỉ sau vài phần mười giây.
   */
  useEffect(() => {
    if (gallery.length < 2 || paused || reducedMotion) return;
    const timer = window.setTimeout(() => {
      setSelected((current) => (current + 1) % gallery.length);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [selected, gallery.length, paused, reducedMotion]);

  // Xoá bớt ảnh ở trang quản trị có thể làm chỉ số hiện tại vượt mảng.
  const current = gallery.length > 0 ? Math.min(selected, gallery.length - 1) : 0;

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
            <span className="shrink-0 whitespace-nowrap">{product.category}</span>
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
      <div className="mt-7 grid gap-x-10 gap-y-8 @3xl:grid-cols-[minmax(0,1fr)_400px] @3xl:grid-rows-[auto_1fr] @3xl:items-start">
        <div className="@3xl:col-start-1 @3xl:row-start-1">
          <h1 className="max-w-3xl text-3xl font-semibold text-neutral-950 sm:text-4xl">
            {product.name}
          </h1>
          {product.shortDescription && (
            <p className="mt-3 max-w-2xl leading-7 text-neutral-600">
              {product.shortDescription}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {product.sold > 0 && (
              <span className="inline-flex items-center gap-2 font-medium text-neutral-700">
                <ShoppingBag className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
                {t.product.sold(product.sold)}
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-2 font-medium',
                outOfStock ? 'text-neutral-500' : 'text-emerald-700',
              )}
            >
              {outOfStock ? (
                <PackageX className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <PackageCheck className="h-4 w-4" strokeWidth={1.75} />
              )}
              {outOfStock
                ? t.product.outOfStock
                : t.product.inStockShort(product.availableStock)}
            </span>
          </div>

          {gallery.length > 0 && (
            <div className="mt-7">
              {/*
                KHUNG TỈ LỆ CỐ ĐỊNH, ảnh `object-contain` bên trong.

                4:3 giữ bố cục ổn định ở cả trang thật lẫn preview admin. Không
                làm xám ảnh khi hết hàng: trạng thái mua nằm ở bên phải, còn ảnh
                vẫn phải đủ rõ để khách nhận diện đúng sản phẩm.
              */}
              <div
                className="relative aspect-[4/3] overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
              >
                <div
                  className={cn(
                    'flex h-full',
                    // Không hoạt hình khi người dùng đã bật "giảm chuyển động".
                    reducedMotion ? '' : 'transition-transform duration-500 ease-out',
                  )}
                  style={{ transform: `translateX(-${current * 100}%)` }}
                >
                  {gallery.map((source, index) => (
                    <div
                      key={index}
                      className="flex h-full w-full shrink-0 items-center justify-center p-6 @xl:p-10"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={source}
                        alt={index === 0 ? product.name : ''}
                        // Ảnh đầu tải ngay vì nó nằm trong màn hình đầu tiên;
                        // các ảnh sau nằm ngoài khung nên để trình duyệt hoãn.
                        loading={index === 0 ? 'eager' : 'lazy'}
                        className="max-h-full max-w-full rounded-md object-contain"
                      />
                    </div>
                  ))}
                </div>

                {gallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      aria-label={t.product.previousImage}
                      title={t.product.previousImage}
                      onClick={() => setSelected((current - 1 + gallery.length) % gallery.length)}
                      className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm transition-colors hover:bg-neutral-950 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                    >
                      <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      aria-label={t.product.nextImage}
                      title={t.product.nextImage}
                      onClick={() => setSelected((current + 1) % gallery.length)}
                      className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm transition-colors hover:bg-neutral-950 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
                    >
                      <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
                    </button>
                    <span className="absolute bottom-3 right-3 rounded-md bg-neutral-950/85 px-2 py-1 text-xs font-medium tabular-nums text-white">
                      {current + 1}/{gallery.length}
                    </span>
                  </>
                )}
              </div>

              {gallery.length > 1 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {gallery.map((source, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={t.product.viewImage(index + 1)}
                      aria-pressed={index === current}
                      onClick={() => setSelected(index)}
                      className={cn(
                        'h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-neutral-50 p-1 transition-colors',
                        index === current
                          ? 'border-neutral-950'
                          : 'border-neutral-200 hover:border-neutral-500',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={source}
                        alt=""
                        loading="lazy"
                        className="h-full w-full rounded object-contain"
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

        <section className="space-y-5 border-t border-neutral-200 pt-8 @3xl:col-start-1 @3xl:row-start-2">
          <h2 className="text-xl font-semibold text-neutral-950">{t.product.descriptionTitle}</h2>
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
