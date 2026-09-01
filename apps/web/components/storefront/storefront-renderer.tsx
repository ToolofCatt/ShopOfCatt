'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { StorefrontBlock, StorefrontBlockType, StorefrontDocument, StorefrontLocale, StorefrontPageKind } from '@webcatt/shared';
import { cn } from '@/lib/cn';
import { useStorefront } from '@/lib/storefront';

export type StorefrontSlots = Partial<Record<StorefrontBlockType, ReactNode>>;

export function StorefrontRenderer({ document, page, locale, slots = {}, selectedId, onSelect }: {
  document: StorefrontDocument;
  page: StorefrontPageKind;
  locale: StorefrontLocale;
  slots?: StorefrontSlots;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const storefront = useStorefront();
  return (
    <div data-storefront-page={page} className="storefront-renderer">
      {document.pages[page].blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} locale={locale} slots={slots} selectedId={selectedId} onSelect={onSelect} mediaUrl={storefront.mediaUrl} />
      ))}
    </div>
  );
}

function BlockRenderer({ block, locale, slots, selectedId, onSelect, mediaUrl }: {
  block: StorefrontBlock;
  locale: StorefrontLocale;
  slots: StorefrontSlots;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  mediaUrl: (id: string | null) => string | null;
}) {
  const children = block.children?.map((child) => <BlockRenderer key={child.id} block={child} locale={locale} slots={slots} selectedId={selectedId} onSelect={onSelect} mediaUrl={mediaUrl} />);
  const editing = Boolean(onSelect);
  const shell = (content: ReactNode, className?: string, style?: CSSProperties) => (
    <div
      data-block-id={block.id}
      data-block-type={block.type}
      onClick={editing ? (event) => { event.stopPropagation(); onSelect?.(block.id); } : undefined}
      className={cn(className, editing && 'relative cursor-pointer outline outline-1 outline-transparent hover:outline-neutral-300', selectedId === block.id && 'outline-2 outline-neutral-950')}
      style={style}
    >
      {content}
      {editing && selectedId === block.id && <span className="pointer-events-none absolute left-1 top-1 z-10 bg-neutral-950 px-1.5 py-0.5 text-[10px] font-medium text-white">{block.type}</span>}
    </div>
  );

  if (block.type in slots && slots[block.type] !== undefined) return shell(slots[block.type]);
  switch (block.type) {
    case 'section':
      return shell(children, 'w-full border-y border-transparent px-4', { paddingTop: spacing(block.props.paddingY, 32), paddingBottom: spacing(block.props.paddingY, 32), backgroundColor: color(block.props.background) });
    case 'container':
      return shell(children, 'mx-auto w-full px-4', { maxWidth: number(block.props.maxWidth, 1152) });
    case 'grid':
      return shell(children, 'mx-auto grid w-full grid-cols-1 px-4 sm:grid-cols-2 lg:grid-cols-[repeat(var(--builder-cols),minmax(0,1fr))]', { maxWidth: 'var(--store-container)', gap: spacing(block.props.gap, 24), '--builder-cols': String(clamp(number(block.props.columns, 3), 1, 4)) } as CSSProperties);
    case 'columns':
      return shell(children, 'mx-auto grid w-full grid-cols-1 px-4 md:grid-cols-2', { maxWidth: 'var(--store-container)', gap: spacing(block.props.gap, 24) });
    case 'stack':
      return shell(children, 'flex flex-col', { gap: spacing(block.props.gap, 16), alignItems: alignment(block.props.align) });
    case 'divider':
      return shell(<hr className="border-[var(--store-border)]" />, 'mx-auto w-full px-4', { maxWidth: 'var(--store-container)', paddingTop: spacing(block.props.space, 8), paddingBottom: spacing(block.props.space, 8) });
    case 'spacer':
      return shell(null, 'w-full', { height: spacing(block.props.height, 32) });
    case 'heading': {
      const text = localized(block.props, 'text', locale) || 'Heading';
      const level = clamp(number(block.props.level, 2), 1, 4);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return shell(<Tag className={cn('font-semibold text-[var(--store-foreground)]', level === 1 ? 'text-4xl' : level === 2 ? 'text-2xl' : 'text-lg')} style={{ fontFamily: 'var(--store-heading-font)' }}>{text}</Tag>, 'mx-auto w-full px-4 py-3', { maxWidth: 'var(--store-container)', textAlign: textAlign(block.props.align) });
    }
    case 'richText': {
      const html = localized(block.props, 'html', locale);
      return html ? shell(<div className="wc-prose text-sm leading-7 text-[var(--store-muted)]" dangerouslySetInnerHTML={{ __html: html }} />, 'mx-auto w-full px-4 py-3', { maxWidth: 'var(--store-container)' }) : null;
    }
    case 'image': {
      const src = mediaUrl(typeof block.props.assetId === 'string' ? block.props.assetId : null) ?? '';
      if (!src) return editing ? shell(<div className="flex aspect-[4/3] items-center justify-center border border-dashed border-neutral-300 text-sm text-neutral-400">Image</div>, 'mx-auto w-full max-w-3xl px-4') : null;
      return shell(<img src={src} alt={localized(block.props, 'alt', locale)} className="max-h-[640px] w-full object-contain" />, 'mx-auto w-full px-4 py-3', { maxWidth: 'var(--store-container)' });
    }
    case 'banner':
      return shell(<div className="px-5 py-6"><p className="text-xs font-semibold uppercase text-[var(--store-muted)]">{localized(block.props, 'eyebrow', locale)}</p><h2 className="mt-1 text-2xl font-semibold" style={{ fontFamily: 'var(--store-heading-font)' }}>{localized(block.props, 'title', locale) || 'Digital Store'}</h2><p className="mt-2 max-w-2xl text-sm text-[var(--store-muted)]">{localized(block.props, 'body', locale)}</p></div>, 'mx-auto my-4 w-[calc(100%-2rem)] border border-[var(--store-border)] bg-[var(--store-surface)]', { maxWidth: 'var(--store-container)', borderRadius: 'var(--store-radius)' });
    case 'features':
    case 'faq':
    case 'contact': {
      const title = localized(block.props, 'title', locale);
      const body = localized(block.props, 'body', locale);
      if (!title && !body && !editing) return null;
      return shell(<div><h3 className="font-semibold">{title || block.type}</h3>{body && <p className="mt-2 text-sm text-[var(--store-muted)]">{body}</p>}</div>, 'mx-auto w-full px-4 py-5', { maxWidth: 'var(--store-container)' });
    }
    case 'announcement':
      return slots.announcement ? shell(slots.announcement) : null;
    default:
      return editing ? shell(<div className="mx-auto my-3 flex min-h-24 max-w-5xl items-center justify-center border border-dashed border-neutral-300 bg-neutral-50 text-sm font-medium text-neutral-500">{block.type}</div>) : null;
  }
}

function localized(props: Record<string, unknown>, key: string, locale: StorefrontLocale): string {
  const value = props[key];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    const exact = row[locale];
    if (typeof exact === 'string') return exact;
    if (typeof row.vi === 'string') return row.vi;
  }
  const direct = props[locale];
  return typeof direct === 'string' ? direct : '';
}

function number(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function spacing(value: unknown, fallback: number): string { return `${clamp(number(value, fallback), 0, 160)}px`; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function color(value: unknown): string | undefined { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined; }
function alignment(value: unknown): CSSProperties['alignItems'] { return value === 'center' || value === 'end' || value === 'start' ? value === 'end' ? 'flex-end' : value === 'start' ? 'flex-start' : 'center' : undefined; }
function textAlign(value: unknown): CSSProperties['textAlign'] { return value === 'center' || value === 'right' ? value : 'left'; }
