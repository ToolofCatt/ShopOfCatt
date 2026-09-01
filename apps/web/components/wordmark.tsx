'use client';

import { cn } from '@/lib/cn';
import { useStorefront } from '@/lib/storefront';

const FALLBACK_SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Digital Store';

/**
 * Chữ hiệu của cửa hàng — từ đầu trong khối đen, phần tên còn lại nằm bên cạnh.
 * Đơn sắc hoàn toàn, nhại lại kiểu chữ tách hai tông của logo.
 */

type WordmarkSize = 'sm' | 'md' | 'lg';

const SIZES: Record<
  WordmarkSize,
  { text: string; chip: string; gap: string; tracking: string }
> = {
  sm: {
    text: 'text-sm',
    chip: 'px-1.5 py-1',
    gap: 'ml-1',
    tracking: 'tracking-[0.06em] -mr-[0.06em]',
  },
  md: {
    text: 'text-lg',
    chip: 'px-2 py-1',
    gap: 'ml-1.5',
    tracking: 'tracking-[0.07em] -mr-[0.07em]',
  },
  lg: {
    text: 'text-2xl sm:text-3xl',
    chip: 'px-2.5 py-1.5',
    gap: 'ml-1.5',
    tracking: 'tracking-[0.08em] -mr-[0.08em]',
  },
};

/** "Digital Store" → ["DIGITAL", "STORE"]. Tên một từ thì chỉ có khối đen. */
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ['DIGITAL', 'STORE'];
  if (parts.length === 1) return [parts[0].toUpperCase(), ''];
  return [parts[0].toUpperCase(), parts.slice(1).join(' ').toUpperCase()];
}

export function Wordmark({
  size = 'sm',
  className,
}: {
  size?: WordmarkSize;
  className?: string;
}) {
  const { document } = useStorefront();
  const siteName = document.brand.name || FALLBACK_SITE_NAME;
  const [first, rest] = splitName(siteName);
  const s = SIZES[size];

  return (
    <span
      aria-label={siteName}
      className={cn(
        'inline-flex select-none items-center font-black uppercase leading-none',
        s.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'rounded-md bg-neutral-950 tracking-tight text-white',
          'transition-colors duration-150 group-hover:bg-neutral-700',
          s.chip,
        )}
      >
        {first}
      </span>
      {rest && (
        <span aria-hidden="true" className={cn('text-neutral-950', s.gap, s.tracking)}>
          {rest}
        </span>
      )}
    </span>
  );
}

/** Dạng chữ cho file .txt: "C A T T   S T O R E". */
export function wordmarkText(): string {
  return FALLBACK_SITE_NAME.trim()
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.split('').join(' '))
    .join('   ');
}
