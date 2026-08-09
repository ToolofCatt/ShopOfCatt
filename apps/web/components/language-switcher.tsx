'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT, type Locale } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSelect = (next: Locale) => {
    setOpen(false);
    if (next !== locale) setLocale(next);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.common.language}
        title={t.common.language}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
      >
        <Globe className="h-4 w-4" strokeWidth={1.75} />
        <span className="text-xs font-medium tracking-wide">{LOCALE_SHORT[locale]}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-neutral-200 bg-white py-1.5 shadow-lg"
        >
          {LOCALES.map((item) => (
            <button
              key={item}
              role="menuitemradio"
              aria-checked={item === locale}
              type="button"
              onClick={() => handleSelect(item)}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                item === locale
                  ? 'font-medium text-neutral-950'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="w-6 font-mono text-[11px] text-neutral-400">
                  {LOCALE_SHORT[item]}
                </span>
                {LOCALE_LABELS[item]}
              </span>
              {item === locale && (
                <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
