'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export const PRODUCT_EDITOR_TABS = [
  'overview',
  'content',
  'variants',
  'stock',
  'translations',
  'preview',
] as const;

export type ProductEditorTab = (typeof PRODUCT_EDITOR_TABS)[number];

export interface ProductEditorTabItem {
  value: ProductEditorTab;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export const productTabId = (tab: ProductEditorTab) => `product-editor-tab-${tab}`;
export const productPanelId = (tab: ProductEditorTab) => `product-editor-panel-${tab}`;

interface ProductEditorTabsProps {
  items: readonly ProductEditorTabItem[];
  value: ProductEditorTab;
  onChange: (value: ProductEditorTab) => void;
  ariaLabel: string;
}

/**
 * Điều hướng cấp trang có thêm icon, số lượng và liên kết tab/panel riêng.
 * Tab phụ dùng cùng kiểu gạch chân nhưng thấp hơn để vẫn nhìn ra hai cấp điều hướng.
 */
export function ProductEditorTabs({
  items,
  value,
  onChange,
  ariaLabel,
}: ProductEditorTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const index = items.findIndex((item) => item.value === value);
    refs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [items, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = items[nextIndex];
    onChange(next.value);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex min-w-max border-b border-neutral-200"
      >
        {items.map((item, index) => {
          const active = item.value === value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              id={productTabId(item.value)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={productPanelId(item.value)}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                'relative inline-flex h-12 cursor-pointer items-center gap-2 px-3 text-sm font-medium',
                'transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-950',
                active ? 'text-neutral-950' : 'text-neutral-500 hover:text-neutral-950',
              )}
            >
              <Icon strokeWidth={1.75} className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] tabular-nums',
                    active ? 'bg-neutral-950 text-white' : 'bg-neutral-100 text-neutral-500',
                  )}
                >
                  {item.count}
                </span>
              )}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-neutral-950 transition-opacity',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
