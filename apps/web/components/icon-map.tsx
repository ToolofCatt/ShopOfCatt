import { Package } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ProductVisualProps {
  image: string | null;
  name: string;
  /** Sizing/shape of the tile, e.g. "aspect-[4/3] w-full". */
  className?: string;
  /** Sizing of the placeholder icon, e.g. "h-10 w-10". */
  iconClassName?: string;
}

/**
 * Ảnh sản phẩm, hoặc một ô biểu tượng thay thế khi chủ shop chưa tải ảnh lên.
 *
 * Trước đây mỗi sản phẩm còn chọn được một icon riêng từ danh sách tên component
 * lucide bằng tiếng Anh — thứ chẳng nói lên điều gì với khách, và chỉ hiện ra khi
 * sản phẩm thiếu ảnh. Bỏ đi, còn lại đúng một ô thay thế trung tính.
 */
export function ProductVisual({ image, name, className, iconClassName }: ProductVisualProps) {
  if (image) {
    return (
      <div className={cn('overflow-hidden rounded-lg bg-neutral-100', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div className={cn('flex items-center justify-center rounded-lg bg-neutral-100', className)}>
      <Package
        strokeWidth={1.5}
        className={cn('text-neutral-500', iconClassName ?? 'h-10 w-10')}
      />
    </div>
  );
}
