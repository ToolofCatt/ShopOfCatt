import {
  AppWindow,
  BookOpen,
  Gamepad2,
  Gift,
  GraduationCap,
  KeyRound,
  Package,
  Palette,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/** Icon-name string (stored on Product.icon) → lucide component. */
export const PRODUCT_ICON_MAP: Record<string, LucideIcon> = {
  KeyRound,
  AppWindow,
  Gift,
  Gamepad2,
  GraduationCap,
  Shield,
  BookOpen,
  Palette,
};

/** The 8 selectable icon names (admin product form select). */
export const PRODUCT_ICON_NAMES = Object.keys(PRODUCT_ICON_MAP);

export function getProductIcon(name: string | null | undefined): LucideIcon {
  if (name && name in PRODUCT_ICON_MAP) return PRODUCT_ICON_MAP[name];
  return Package;
}

export interface ProductVisualProps {
  icon: string | null;
  image: string | null;
  name: string;
  /** Sizing/shape of the tile, e.g. "aspect-[4/3] w-full". */
  className?: string;
  /** Sizing of the centered icon, e.g. "h-10 w-10". */
  iconClassName?: string;
}

/**
 * Product visual: `image` when set, otherwise the mapped lucide icon
 * centered in a neutral tile.
 */
export function ProductVisual({ icon, image, name, className, iconClassName }: ProductVisualProps) {
  if (image) {
    return (
      <div className={cn('overflow-hidden rounded-lg bg-neutral-100', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }
  const Icon = getProductIcon(icon);
  return (
    <div className={cn('flex items-center justify-center rounded-lg bg-neutral-100', className)}>
      <Icon strokeWidth={1.5} className={cn('text-neutral-500', iconClassName ?? 'h-10 w-10')} />
    </div>
  );
}
