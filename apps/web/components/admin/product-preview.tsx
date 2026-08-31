'use client';

import {
  toUsdtFromCurrency,
  type DisplayCurrency,
  type ProductDto,
  type ProductImageDto,
  type ProductVariantDto,
} from '@webcatt/shared';
import { ProductCard } from '@/components/product-card';
import { ProductDetail } from '@/components/product-detail';
import { useI18n } from '@/lib/i18n/client';

/**
 * Khung xem trước: sản phẩm đang soạn trông thế nào với khách.
 *
 * Dùng thẳng `ProductCard` và `ProductDetail` — đúng hai component trang khách
 * đang chạy — nên xem trước không bao giờ lệch với thực tế.
 */

export interface ProductPreviewInput {
  name: string;
  slug: string;
  category: string;
  shortDescription: string;
  description: string;
  image: string;
  thumbnail: string;
  /** Ảnh phụ đã lưu (chỉ có ở chế độ sửa). */
  images: ProductImageDto[];
  /** Chỉ có ở chế độ tạo mới: giá của loại "Mặc định" sắp được tạo. */
  price: string;
  /** Đơn vị neo của giá đó. */
  priceCurrency: DisplayCurrency;
  /** Chế độ sửa: các loại có thật; chế độ tạo mới thì rỗng. */
  variants: ProductVariantDto[];
}

/** Loại giả cho chế độ tạo mới, để khối giá và tồn kho có gì đó mà hiển thị. */
function previewVariants(input: ProductPreviewInput): ProductVariantDto[] {
  if (input.variants.length > 0) return input.variants;
  const soDaGo = Number(input.price) || 0;
  return [
    {
      id: 'preview',
      name: 'Mặc định',
      // `price` (USDT) chỉ dùng để so xem loại nào rẻ nhất; con số khách thấy
      // đến từ `priceAmount` + `priceCurrency`, nên xem trước không cần tỉ giá.
      price: toUsdtFromCurrency(soDaGo, input.priceCurrency, null) ?? soDaGo,
      priceCurrency: input.priceCurrency,
      priceAmount: soDaGo,
      sortOrder: 0,
      active: true,
      availableStock: 10,
      sold: 0,
    },
  ];
}

function toPreviewProduct(input: ProductPreviewInput, fallbackName: string): ProductDto {
  const variants = previewVariants(input);
  const active = variants.filter((variant) => variant.active);
  const prices = active.map((variant) => variant.price);

  return {
    id: 'preview',
    slug: input.slug.trim() || 'preview',
    name: input.name.trim() || fallbackName,
    shortDescription: input.shortDescription.trim() || null,
    description: input.description.trim() || null,
    currency: 'USDT',
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    image: input.image || null,
    thumbnail: input.thumbnail || null,
    // Khung xem trước không quan tâm cỡ ảnh; chỉ cần khác null khi có ảnh để
    // các nhánh "có ảnh hay chưa" chạy giống hệt trang thật.
    imageBytes: input.image ? input.image.length : null,
    thumbnailBytes: input.thumbnail ? input.thumbnail.length : null,
    images: input.images,
    category: input.category.trim() || null,
    sortOrder: 0,
    // Xem trước không rút kho thật — giá trị nào cũng không đổi hiển thị.
    stockDrawMode: 'SEQUENTIAL',
    active: true,
    availableStock: active.reduce((sum, variant) => sum + variant.availableStock, 0),
    // Tổng đã bán là trọn đời: loại đã tắt vẫn góp vào số liệu, dù không còn
    // xuất hiện trong lựa chọn mua và không góp vào tồn kho khả dụng.
    sold: variants.reduce((sum, variant) => sum + variant.sold, 0),
    variants,
    createdAt: '',
  };
}

export function ProductPreview({ input }: { input: ProductPreviewInput }) {
  const { t } = useI18n();
  const product = toPreviewProduct(input, t.admin.previewUntitled);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-800">{t.admin.previewTitle}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{t.admin.previewHint}</p>
      </div>

      {/*
        KHOÁ MỌI TƯƠNG TÁC. Hai lý do, cả hai đều gây hậu quả thật:
        - `BuyBox` gọi POST /orders bằng chính token admin đang đăng nhập, nên lỡ
          bấm "Mua ngay" trong khung xem trước là tạo một đơn hàng thật.
        - `ProductCard` là một <Link>: bấm vào sẽ rời khỏi biểu mẫu chưa lưu, và ở
          production Next còn tải trước trang khi rê chuột qua.
        `inert` chặn luôn cả điều hướng bằng bàn phím, thứ pointer-events không chặn.
      */}
      <div className="pointer-events-none select-none" aria-hidden="true" inert>
        <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] lg:items-start">
          <div className="mx-auto w-full max-w-sm lg:mx-0">
            <ProductCard product={product} />
          </div>

          <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5">
            <ProductDetail product={product} />
          </div>
        </div>
      </div>
    </div>
  );
}
