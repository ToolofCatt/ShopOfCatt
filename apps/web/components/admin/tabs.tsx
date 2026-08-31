'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Tab phụ dùng chung cũng đi theo ngôn ngữ gạch chân của tab cấp trang.
 * Cuộn ngang thay vì xuống dòng để thứ tự lựa chọn không bị đảo trên màn hình hẹp.
 */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const index = items.findIndex((item) => item.value === value);
    const list = listRef.current;
    const tab = refs.current[index];
    if (!list || !tab) return;

    // `scrollIntoView` còn cuộn cả trang tới tab nằm dưới màn hình, làm trang cài đặt nhảy vị trí.
    const listBounds = list.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    if (tabBounds.left < listBounds.left) {
      list.scrollLeft += tabBounds.left - listBounds.left;
    } else if (tabBounds.right > listBounds.right) {
      list.scrollLeft += tabBounds.right - listBounds.right;
    }
  }, [items, value]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (items.length === 0) return;

    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    onChange(items[nextIndex].value);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        'inline-flex max-w-full flex-nowrap items-center overflow-x-auto border-b border-neutral-200',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'relative inline-flex h-10 shrink-0 cursor-pointer items-center whitespace-nowrap px-3 text-[13px] font-medium',
              'transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-950',
              active
                ? 'text-neutral-950'
                : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950',
            )}
          >
            {item.label}
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
  );
}
