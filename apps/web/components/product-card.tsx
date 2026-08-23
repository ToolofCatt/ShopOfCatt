'use client';

import Link from 'next/link';
import { cheapestAnchored, type ProductDto } from '@webcatt/shared';
import { usePrices } from '@/lib/prices';
import { ProductVisual } from '@/components/icon-map';
import { Badge } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

export function ProductCard({ product }: { product: ProductDto }) {
  const { t } = useI18n();
  const { price, priceUsdt } = usePrices();
  const outOfStock = product.availableStock <= 0;
  /*
    Nhiều loại với giá khác nhau → hiển thị "Từ {giá thấp nhất}".

    Lấy NEO của loại rẻ nhất, không lấy `minPrice` (USDT thuần): chỉ có neo mới
    hiện được đúng con số tròn chủ shop đã gõ. Không có loại nào đang bán thì
    mới lùi về `minPrice`.
  */
  const neo = cheapestAnchored(product.variants);
  const gia = neo ? price(neo) : priceUsdt(product.minPrice);
  const priceLabel =
    product.maxPrice > product.minPrice
      ? t.product.priceFrom(gia.primary)
      : gia.primary;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-neutral-400"
    >
      {/*
        Ruy-băng chéo ở góc trên bên phải. `overflow-hidden` ở thẻ cha cắt hai
        đầu thừa — bỏ nó là dải băng thò ra ngoài viền và đè lên thẻ bên cạnh.
        `pointer-events-none` để nó không nuốt cú bấm vào thẻ.

        `z-10` KHÔNG thừa: ô ảnh bên dưới mang `opacity-50 grayscale` khi hết
        hàng, mà opacity < 1 và filter đều tạo stacking context. Ruy-băng (định
        vị tuyệt đối, z tự động) và ô ảnh khi đó nằm CÙNG một tầng vẽ, và cùng
        tầng thì cái đứng sau trong DOM thắng — tức ảnh đè lên ruy-băng. Đúng
        lúc hết hàng mới có `opacity-50`, nên bỏ z-10 là lỗi xảy ra 100%.
      */}
      {outOfStock && (
        <span
          className="pointer-events-none absolute -right-9 top-4 z-10 w-32 rotate-45 bg-neutral-900 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm"
        >
          {t.product.outOfStock}
        </span>
      )}
      <ProductVisual
        // Danh sách chỉ có ảnh nhỏ: truy vấn list không kéo cột ảnh lớn về.
        image={product.thumbnail ?? product.image}
        name={product.name}
        className={cn('aspect-[4/3] w-full', outOfStock && 'opacity-50 grayscale')}
        iconClassName="h-10 w-10"
      />

      {/*
        `flex-1` ở khối chữ (chứ không ở giá): giá phải dính ngay dưới tên/mô tả,
        còn khoảng trống khi thẻ này thấp hơn thẻ bên cạnh thì dồn xuống phía
        dưới. Đảo lại là giá bị đẩy rời khỏi tên, mỗi thẻ một độ cao khác nhau.
      */}
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
        {/*
          Một dòng giá duy nhất, theo đơn vị của ngôn ngữ khách đang xem.
          `whitespace-nowrap`: thẻ ở lưới 2 cột trên điện thoại chỉ rộng ~170px,
          không có nó thì giá bị ngắt làm đôi ("10.50" xuống dòng rời khỏi
          "USDT").
        */}
        <p className="mt-1 whitespace-nowrap font-semibold tabular-nums text-neutral-950">
          {priceLabel}
        </p>
      </div>

      {/*
        Hàng cuối: "đã bán" bên trái, tồn kho bên phải — hai con số khách hay so
        với nhau nên để cùng hàng. "Đã bán" có thể vắng, nên `ml-auto` ở nhãn tồn
        kho: chỉ dựa vào `justify-between` thì khi thiếu "đã bán" nhãn tồn kho
        tụt về bên trái.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-neutral-100 pt-3">
        {/* Cửa hàng mới thì "đã bán 0" là bằng chứng NGƯỢC — ẩn cho tới khi có số thật. */}
        {product.sold > 0 && (
          <span className="whitespace-nowrap text-[11px] text-neutral-400">
            {t.product.sold(product.sold)}
          </span>
        )}
        {/*
          Hết hàng vẫn hiện nhãn "Còn 0" (chủ shop yêu cầu): ô này biến mất là
          khách tưởng thẻ bị lỗi hiển thị. Đổi sang `muted` để nó không trông như
          một lời quảng cáo còn hàng, còn `Math.max` chặn trường hợp tồn kho âm
          — không được để giao diện khoe "Còn -2".
        */}
        <Badge variant={outOfStock ? 'muted' : 'outline'} className="ml-auto">
          {t.product.inStockShort(Math.max(0, product.availableStock))}
        </Badge>
      </div>
    </Link>
  );
}
