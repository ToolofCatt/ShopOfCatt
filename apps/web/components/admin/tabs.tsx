'use client';

import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Segmented filter tabs — active segment is black, the rest are ghost. */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'cursor-pointer whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              active
                ? 'bg-neutral-950 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
