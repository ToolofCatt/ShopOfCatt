'use client';

import { type ChangeEvent } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { StorefrontBlock, StorefrontDocument, StorefrontLocale, StoreMediaAssetDto } from '@webcatt/shared';
import { Badge, Button, Field, Input } from '../components/ui';
import { apiBaseUrl } from './api';
import { useI18n } from './i18n/client';
import { builderBlockLocked, builderLocalizedValue, builderTextFields, setBuilderLocalized } from './builder-document';

const selectClass = 'h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-950';

export function BuilderBlockInspector({ block, locale, media, onChange, onDelete, onUpload }: {
  block: StorefrontBlock; locale: StorefrontLocale; media: StoreMediaAssetDto[];
  onChange: (recipe: (block: StorefrontBlock) => void) => void;
  onDelete: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t: { builderUx: copy } } = useI18n();
  const locked = builderBlockLocked(block);
  const prefix = `builder-block-${block.id}`;
  const labels: Record<string, string> = { text: copy.text, title: copy.titleField, body: copy.body, html: copy.html, alt: copy.alt };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs uppercase text-neutral-500">{copy.block}</p><h2 className="font-semibold">{copy.blocks[block.type as keyof typeof copy.blocks] ?? block.type}</h2><p className="mt-1 break-all font-mono text-[10px] text-neutral-500">{block.id}</p></div>{locked && <Badge variant="muted">{copy.locked}</Badge>}</div>
    {locked && <p className="text-xs text-neutral-600">{copy.lockedHint}</p>}
    {builderTextFields(block.type).map((key) => <Field key={key} htmlFor={`${prefix}-${key}`} label={`${labels[key]} · ${locale.toUpperCase()}`}>
      {key === 'body' || key === 'html' ? <textarea id={`${prefix}-${key}`} value={builderLocalizedValue(block, key, locale)} onChange={(event) => onChange((target) => setBuilderLocalized(target, key, locale, event.target.value))} className={`w-full rounded-md border border-neutral-300 p-3 text-sm ${key === 'html' ? 'min-h-40 font-mono' : 'min-h-24'}`} /> : <Input id={`${prefix}-${key}`} value={builderLocalizedValue(block, key, locale)} onChange={(event) => onChange((target) => setBuilderLocalized(target, key, locale, event.target.value))} />}
    </Field>)}
    {block.type === 'heading' && <Field htmlFor={`${prefix}-level`} label={copy.level}><select id={`${prefix}-level`} value={Number(block.props.level ?? 2)} onChange={(event) => onChange((target) => { target.props.level = Number(event.target.value); })} className={selectClass}>{[1, 2, 3, 4].map((level) => <option key={level} value={level}>H{level}</option>)}</select></Field>}
    {block.type === 'image' && <>
      <Field htmlFor={`${prefix}-media`} label={copy.media}><select id={`${prefix}-media`} value={typeof block.props.assetId === 'string' ? block.props.assetId : ''} onChange={(event) => onChange((target) => { target.props.assetId = event.target.value || null; })} className={selectClass}><option value="">{copy.chooseImage}</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.id.slice(-8)} · {asset.width}×{asset.height}</option>)}</select></Field>
      <label htmlFor={`${prefix}-upload`} className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-neutral-950"><Upload aria-hidden="true" className="h-4 w-4" />{copy.upload}<input id={`${prefix}-upload`} type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={onUpload} /></label>
    </>}
    {['section', 'grid', 'columns', 'stack', 'spacer'].includes(block.type) && <Field htmlFor={`${prefix}-gap`} label={copy.gap}><Input id={`${prefix}-gap`} type="number" min="0" max="160" value={Number(block.props.gap ?? block.props.height ?? block.props.paddingY ?? 24)} onChange={(event) => onChange((target) => { const key = target.type === 'spacer' ? 'height' : target.type === 'section' ? 'paddingY' : 'gap'; target.props[key] = Number(event.target.value); })} /></Field>}
    {!locked && <Button variant="danger" className="w-full" onClick={onDelete}><Trash2 aria-hidden="true" className="h-4 w-4" />{copy.deleteBlock}</Button>}
  </div>;
}

export function BuilderThemeInspector({ document, locale, media, mutate, onUpload }: {
  document: StorefrontDocument; locale: StorefrontLocale; media: StoreMediaAssetDto[];
  mutate: (recipe: (next: StorefrontDocument) => void) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, target: 'logo' | 'favicon' | 'image') => void;
}) {
  const { t: { builderUx: copy } } = useI18n();
  return <div className="space-y-5">
    <div><h2 className="font-semibold">{copy.theme}</h2><p className="mt-1 text-xs text-neutral-500">{copy.themeHint}</p></div>
    <Field htmlFor="builder-store-name" label={copy.storeName}><Input id="builder-store-name" value={document.brand.name} onChange={(event) => mutate((next) => { next.brand.name = event.target.value; })} /></Field>
    <Field htmlFor="builder-short-name" label={copy.shortName}><Input id="builder-short-name" value={document.brand.shortName} onChange={(event) => mutate((next) => { next.brand.shortName = event.target.value; })} /></Field>
    <Field htmlFor="builder-tagline" label={`${copy.tagline} · ${locale.toUpperCase()}`}><Input id="builder-tagline" value={document.brand.tagline[locale]} onChange={(event) => mutate((next) => { next.brand.tagline[locale] = event.target.value; })} /></Field>
    <div className="grid grid-cols-2 gap-2"><UploadField id="builder-logo" label={copy.logo} current={document.brand.logoAssetId} media={media} onChange={(id) => mutate((next) => { next.brand.logoAssetId = id; })} onUpload={(event) => onUpload(event, 'logo')} /><UploadField id="builder-favicon" label={copy.favicon} current={document.brand.faviconAssetId} media={media} onChange={(id) => mutate((next) => { next.brand.faviconAssetId = id; })} onUpload={(event) => onUpload(event, 'favicon')} /></div>
    <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4">
      <Field htmlFor="builder-preset" label={copy.preset}><select id="builder-preset" value={document.theme.preset} onChange={(event) => mutate((next) => applyPreset(next, event.target.value as StorefrontDocument['theme']['preset']))} className={selectClass}>{(['minimal', 'commerce', 'compact'] as const).map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}</select></Field>
      <Field htmlFor="builder-button-style" label={copy.buttonStyle}><select id="builder-button-style" value={document.theme.buttonStyle} onChange={(event) => mutate((next) => { next.theme.buttonStyle = event.target.value as StorefrontDocument['theme']['buttonStyle']; })} className={selectClass}>{(['solid', 'outline', 'soft'] as const).map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}</select></Field>
      <Field htmlFor="builder-heading-font" label={copy.headingFont}><FontSelect id="builder-heading-font" value={document.theme.headingFont} onChange={(value) => mutate((next) => { next.theme.headingFont = value; })} /></Field>
      <Field htmlFor="builder-body-font" label={copy.bodyFont}><FontSelect id="builder-body-font" value={document.theme.bodyFont} onChange={(value) => mutate((next) => { next.theme.bodyFont = value; })} /></Field>
    </div>
    <div className="border-t border-neutral-200 pt-4"><p className="mb-3 text-xs font-semibold uppercase text-neutral-500">{copy.colors}</p><div className="grid grid-cols-2 gap-3">{Object.entries(document.theme.colors).map(([key, value]) => <div key={key}><label htmlFor={`builder-color-${key}`} className="mb-1 block text-[11px] text-neutral-500">{copy.colorLabels[key as keyof typeof copy.colorLabels]}</label><div className="flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-2"><input id={`builder-color-${key}`} type="color" value={value} onChange={(event) => mutate((next) => { next.theme.colors[key as keyof typeof next.theme.colors] = event.target.value; })} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-[10px]">{value}</span></div></div>)}</div></div>
    <Field htmlFor="builder-radius" label={`${copy.radius} · ${document.theme.radius}px`}><input id="builder-radius" type="range" min="0" max="16" value={document.theme.radius} onChange={(event) => mutate((next) => { next.theme.radius = Number(event.target.value); })} className="w-full accent-neutral-950" /></Field>
    <Field htmlFor="builder-width" label={`${copy.width} · ${document.theme.containerWidth}px`}><input id="builder-width" type="range" min="960" max="1600" step="16" value={document.theme.containerWidth} onChange={(event) => mutate((next) => { next.theme.containerWidth = Number(event.target.value); })} className="w-full accent-neutral-950" /></Field>
    <Field htmlFor="builder-density" label={copy.density}><select id="builder-density" value={document.theme.density} onChange={(event) => mutate((next) => { next.theme.density = event.target.value as StorefrontDocument['theme']['density']; })} className={selectClass}>{(['compact', 'comfortable', 'spacious'] as const).map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}</select></Field>
  </div>;
}

function UploadField({ id, label, current, media, onChange, onUpload }: { id: string; label: string; current: string | null; media: StoreMediaAssetDto[]; onChange: (id: string | null) => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const { t: { builderUx: copy } } = useI18n();
  return <div><label htmlFor={`${id}-upload`} className="mb-1.5 block text-xs font-medium">{copy.upload} · {label}</label><div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50 focus-within:ring-2 focus-within:ring-neutral-950">{current ? <img src={`${apiBaseUrl()}/storefront/media/${current}`} alt="" className="h-full w-full object-contain" /> : <Upload aria-hidden="true" className="h-4 w-4 text-neutral-400" />}<input id={`${id}-upload`} type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 w-full cursor-pointer opacity-0" onChange={onUpload} /></div><label htmlFor={`${id}-media`} className="mt-2 block text-xs text-neutral-500">{copy.media} · {label}</label><select id={`${id}-media`} value={current ?? ''} onChange={(event) => onChange(event.target.value || null)} className="mt-1 h-9 w-full rounded border border-neutral-200 bg-white px-1 text-xs"><option value="">{copy.noImage}</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.id.slice(-8)}</option>)}</select></div>;
}

function FontSelect({ id, value, onChange }: { id: string; value: StorefrontDocument['theme']['bodyFont']; onChange: (value: StorefrontDocument['theme']['bodyFont']) => void }) {
  const { t: { builderUx: copy } } = useI18n();
  return <select id={id} value={value} onChange={(event) => onChange(event.target.value as StorefrontDocument['theme']['bodyFont'])} className={selectClass}><option value="geist">Geist</option>{(['system-sans', 'system-serif', 'system-mono'] as const).map((value) => <option key={value} value={value}>{copy.options[value]}</option>)}</select>;
}

function applyPreset(document: StorefrontDocument, preset: StorefrontDocument['theme']['preset']): void {
  document.theme.preset = preset;
  if (preset === 'minimal') Object.assign(document.theme, { radius: 6, density: 'comfortable', buttonStyle: 'solid', containerWidth: 1152, colors: { ...document.theme.colors, background: '#ffffff', surface: '#ffffff', foreground: '#0a0a0a', muted: '#737373', primary: '#0a0a0a', primaryForeground: '#ffffff', border: '#e5e5e5' } });
  if (preset === 'commerce') Object.assign(document.theme, { radius: 8, density: 'comfortable', buttonStyle: 'solid', containerWidth: 1200, colors: { ...document.theme.colors, background: '#f7f7f8', surface: '#ffffff', foreground: '#171717', muted: '#666666', primary: '#0f766e', primaryForeground: '#ffffff', border: '#dedede', success: '#15803d', danger: '#dc2626' } });
  if (preset === 'compact') Object.assign(document.theme, { radius: 4, density: 'compact', buttonStyle: 'outline', containerWidth: 1280, colors: { ...document.theme.colors, background: '#ffffff', surface: '#ffffff', foreground: '#111827', muted: '#6b7280', primary: '#111827', primaryForeground: '#ffffff', border: '#d1d5db' } });
}
