'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlignLeft, Columns3, GripVertical, Image as ImageIcon, LayoutGrid, Monitor, PanelTop, Plus, Redo2, Rocket, Rows3, Save, Smartphone, Trash2, Type, Undo2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  STOREFRONT_BLOCK_TYPES,
  STOREFRONT_BUSINESS_BLOCKS,
  STOREFRONT_LOCALES,
  STOREFRONT_PAGE_KINDS,
  type ProductDto,
  type StoreMediaAssetDto,
  type StorefrontBlock,
  type StorefrontBlockType,
  type StorefrontDocument,
  type StorefrontDraftDto,
  type StorefrontLocale,
  type StorefrontPageKind,
  type StorefrontRevisionDto,
} from '@webcatt/shared';
import { ProductBrowser } from '@/components/product-browser';
import { ProductDetail } from '@/components/product-detail';
import { StorefrontRenderer, type StorefrontSlots } from '@/components/storefront/storefront-renderer';
import { Badge, Button, Field, Input, Spinner } from '@/components/ui';
import { apiBaseUrl, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';
import { themeVariables } from '@/lib/storefront';

const LAYOUT_BLOCKS: StorefrontBlockType[] = ['section', 'container', 'grid', 'columns', 'stack', 'divider', 'spacer'];
const CONTENT_BLOCKS: StorefrontBlockType[] = ['heading', 'richText', 'image', 'banner', 'features', 'faq', 'contact'];
const PARENT_BLOCKS = new Set<StorefrontBlockType>(['section', 'container', 'grid', 'columns', 'stack']);
const LABELS: Partial<Record<StorefrontBlockType, string>> = {
  section: 'Section', container: 'Container', grid: 'Grid', columns: 'Columns', stack: 'Stack', divider: 'Divider', spacer: 'Spacer',
  heading: 'Heading', richText: 'Rich text', image: 'Image', banner: 'Banner', features: 'Features', faq: 'FAQ', contact: 'Contact',
};
const PAGE_LABELS: Record<StorefrontPageKind, string> = { home: 'Trang chủ', product: 'Sản phẩm', login: 'Đăng nhập', register: 'Đăng ký', checkout: 'Checkout', orders: 'Danh sách đơn', orderDetail: 'Chi tiết đơn', account: 'Tài khoản', legal: 'Chính sách', maintenance: 'Maintenance' };

export default function DesignPage() {
  const { token } = useAuth();
  const { locale: adminLocale, t } = useI18n();
  const [document, setDocument] = useState<StorefrontDocument | null>(null);
  const documentRef = useRef<StorefrontDocument | null>(null);
  const [version, setVersion] = useState(1);
  const [page, setPage] = useState<StorefrontPageKind>('home');
  const [locale, setLocale] = useState<StorefrontLocale>('vi');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [selected, setSelected] = useState<string | null>(null);
  const [media, setMedia] = useState<StoreMediaAssetDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [revisions, setRevisions] = useState<StorefrontRevisionDto[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<StorefrontDocument[]>([]);
  const [future, setFuture] = useState<StorefrontDocument[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => { documentRef.current = document; }, [document]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [draft, assets, savedRevisions] = await Promise.all([
        apiFetch<StorefrontDraftDto>('/admin/storefront/draft', { token, locale: adminLocale }),
        apiFetch<StoreMediaAssetDto[]>('/admin/storefront/media', { token, locale: adminLocale }),
        apiFetch<StorefrontRevisionDto[]>('/admin/storefront/revisions', { token, locale: adminLocale }),
      ]);
      setDocument(draft.document); documentRef.current = draft.document; setVersion(draft.version);
      setMedia(assets); setRevisions(savedRevisions); setStatus('saved'); setMessage(null);
    } catch (error) { setStatus('error'); setMessage(apiErrorMessage(error, t.common.connectionError)); }
  }, [adminLocale, t.common.connectionError, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    apiFetch<ProductDto[]>('/products', { locale }).then(setProducts).catch(() => setProducts([]));
  }, [locale]);

  const save = useCallback(async (): Promise<boolean> => {
    const snapshot = documentRef.current;
    if (!token || !snapshot) return false;
    if (!dirty) return true;
    if (saving) return false;
    setSaving(true); setStatus('saving');
    const encoded = JSON.stringify(snapshot);
    try {
      const result = await apiFetch<StorefrontDraftDto>('/admin/storefront/draft', { method: 'PUT', token, locale: adminLocale, body: { version, document: snapshot } });
      setVersion(result.version);
      const unchangedWhileSaving = JSON.stringify(documentRef.current) === encoded;
      if (unchangedWhileSaving) { setDocument(result.document); documentRef.current = result.document; setDirty(false); setStatus('saved'); }
      else { setStatus('dirty'); }
      setMessage(null);
      return unchangedWhileSaving;
    } catch (error) { setStatus('error'); setMessage(apiErrorMessage(error, t.common.connectionError)); return false; }
    finally { setSaving(false); }
  }, [adminLocale, dirty, saving, t.common.connectionError, token, version]);

  useEffect(() => {
    if (!dirty || saving) return;
    setStatus('dirty');
    const timer = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer);
  }, [dirty, document, save, saving]);

  const mutate = useCallback((recipe: (next: StorefrontDocument) => void) => {
    setDocument((current) => {
      if (!current) return current;
      setHistory((rows) => [...rows.slice(-39), structuredClone(current)]);
      setFuture([]);
      const next = structuredClone(current); recipe(next); documentRef.current = next; return next;
    });
    setDirty(true); setStatus('dirty');
  }, []);

  const undo = () => {
    const previous = history.at(-1); if (!previous || !document) return;
    setFuture((rows) => [structuredClone(document), ...rows].slice(0, 40)); setHistory((rows) => rows.slice(0, -1));
    const next = structuredClone(previous); setDocument(next); documentRef.current = next; setDirty(true);
  };
  const redo = () => {
    const next = future[0]; if (!next || !document) return;
    setHistory((rows) => [...rows, structuredClone(document)].slice(-40)); setFuture((rows) => rows.slice(1));
    const restored = structuredClone(next); setDocument(restored); documentRef.current = restored; setDirty(true);
  };

  const addBlock = (type: StorefrontBlockType) => mutate((next) => {
    const block = defaultBlock(type, locale);
    const parent = selected ? findBlock(next.pages[page].blocks, selected) : null;
    if (parent && PARENT_BLOCKS.has(parent.type)) {
      parent.children ??= [];
      parent.children.push(block);
    } else {
      next.pages[page].blocks.push(block);
    }
    setSelected(block.id);
  });

  const removeBlock = () => {
    if (!selected || !document) return;
    const block = findBlock(document.pages[page].blocks, selected);
    if (!block || (STOREFRONT_BUSINESS_BLOCKS as readonly string[]).includes(block.type)) return;
    mutate((next) => { next.pages[page].blocks = removeBlockById(next.pages[page].blocks, selected); });
    setSelected(null);
  };

  const dragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    mutate((next) => {
      const rows = next.pages[page].blocks;
      const from = rows.findIndex((row) => row.id === event.active.id);
      const to = rows.findIndex((row) => row.id === event.over?.id);
      if (from >= 0 && to >= 0) next.pages[page].blocks = arrayMove(rows, from, to);
    });
  };

  const publish = async () => {
    if (!token || saving || publishing) return;
    if (dirty && !(await save())) return;
    setMessage(null);
    setPublishing(true);
    try {
      await apiFetch('/admin/storefront/publish', { method: 'POST', token, locale: adminLocale });
      setRevisions(await apiFetch<StorefrontRevisionDto[]>('/admin/storefront/revisions', { token, locale: adminLocale }));
      setMessage('Đã xuất bản snapshot mới.');
    } catch (error) { setMessage(apiErrorMessage(error, t.common.connectionError)); }
    finally { setPublishing(false); }
  };

  const restore = async (id: string) => {
    if (!token || !window.confirm('Khôi phục revision này thành một revision mới?')) return;
    try { await apiFetch(`/admin/storefront/revisions/${id}/restore`, { method: 'POST', token, locale: adminLocale }); await load(); setMessage('Đã khôi phục và tạo revision mới.'); }
    catch (error) { setMessage(apiErrorMessage(error, t.common.connectionError)); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>, target: 'logo' | 'favicon' | 'image' = 'image') => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !token) return;
    try {
      const data = await validateAndReadImage(file);
      const asset = await apiFetch<StoreMediaAssetDto>('/admin/storefront/media', { method: 'POST', token, locale: adminLocale, body: { data } });
      setMedia((rows) => [asset, ...rows]);
      mutate((next) => {
        if (target === 'logo') next.brand.logoAssetId = asset.id;
        else if (target === 'favicon') next.brand.faviconAssetId = asset.id;
        else if (selected) {
          const block = findBlock(next.pages[page].blocks, selected);
          if (block?.type === 'image') block.props.assetId = asset.id;
        }
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  if (!document) return <div className="flex min-h-[60vh] items-center justify-center"><Spinner className="h-6 w-6 text-neutral-400" /></div>;
  const blocks = document.pages[page].blocks;
  const selectedBlock = selected ? findBlock(blocks, selected) : null;
  const slots = previewSlots(products);

  return (
    <div className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-neutral-100 lg:-mx-8">
      <header className="sticky top-16 z-30 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2"><h1 className="text-lg font-semibold">Page Builder</h1><p className="text-xs text-neutral-500">Draft v{version} · {statusLabel(status)}</p></div>
          <select value={page} onChange={(event) => { setPage(event.target.value as StorefrontPageKind); setSelected(null); }} className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm">{STOREFRONT_PAGE_KINDS.map((kind) => <option key={kind} value={kind}>{PAGE_LABELS[kind]}</option>)}</select>
          <div className="flex h-9 rounded-md border border-neutral-300 p-0.5">{STOREFRONT_LOCALES.map((entry) => <button key={entry} onClick={() => setLocale(entry)} className={cn('min-w-9 rounded px-2 text-xs font-semibold uppercase', locale === entry && 'bg-neutral-950 text-white')}>{entry}</button>)}</div>
          <div className="flex h-9 rounded-md border border-neutral-300 p-0.5"><button title="Desktop" onClick={() => setDevice('desktop')} className={cn('rounded px-2', device === 'desktop' && 'bg-neutral-950 text-white')}><Monitor className="h-4 w-4" /></button><button title="Mobile" onClick={() => setDevice('mobile')} className={cn('rounded px-2', device === 'mobile' && 'bg-neutral-950 text-white')}><Smartphone className="h-4 w-4" /></button></div>
          <div className="ml-auto flex gap-1"><Button variant="ghost" size="sm" disabled={history.length === 0} onClick={undo} title="Undo"><Undo2 className="h-4 w-4" /></Button><Button variant="ghost" size="sm" disabled={future.length === 0} onClick={redo} title="Redo"><Redo2 className="h-4 w-4" /></Button><Button variant="outline" size="sm" loading={saving} disabled={!dirty || publishing} onClick={() => void save()}><Save className="h-4 w-4" />Lưu</Button><Button size="sm" loading={publishing} disabled={saving || dirty} onClick={() => void publish()}><Rocket className="h-4 w-4" />Xuất bản</Button></div>
        </div>
        {message && <p role="status" className={cn('mt-2 text-xs', status === 'error' ? 'text-red-600' : 'text-neutral-600')}>{message}</p>}
      </header>

      <div className="grid min-h-[calc(100vh-8.5rem)] grid-cols-1 xl:grid-cols-[13rem_minmax(0,1fr)_19rem]">
        <aside className="border-r border-neutral-200 bg-white p-3">
          <Palette title="Bố cục" blocks={LAYOUT_BLOCKS} onAdd={addBlock} />
          <Palette title="Nội dung" blocks={CONTENT_BLOCKS} onAdd={addBlock} />
          <div className="mt-5 border-t border-neutral-200 pt-4"><p className="mb-2 text-xs font-semibold uppercase text-neutral-400">Revision gần đây</p>{revisions.slice(0, 5).map((revision) => <button key={revision.id} onClick={() => void restore(revision.id)} className="flex w-full items-center justify-between py-1.5 text-left text-xs text-neutral-600 hover:text-neutral-950"><span>v{revision.version}</span><span>{new Date(revision.publishedAt).toLocaleDateString()}</span></button>)}</div>
        </aside>

        <main className="min-w-0 overflow-x-auto p-4 sm:p-8">
          <div data-storefront-preview data-store-preset={document.theme.preset} data-store-button-style={document.theme.buttonStyle} data-store-density={document.theme.density} className={cn('mx-auto min-h-[680px] overflow-hidden bg-white shadow-sm transition-[width] duration-200', device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full max-w-[1180px]')} style={themeVariables(document.theme)}>
            <div className="border-b border-[var(--store-border)] bg-[var(--store-surface)] px-4 py-3 text-xs text-[var(--store-muted)]"><strong className="text-[var(--store-foreground)]">{document.brand.name}</strong> · {PAGE_LABELS[page]} · {locale.toUpperCase()}</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
              <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
                {blocks.map((block) => <SortableCanvasBlock key={block.id} block={block} document={document} page={page} locale={locale} slots={slots} selected={selected} onSelect={setSelected} />)}
              </SortableContext>
            </DndContext>
          </div>
        </main>

        <aside className="border-l border-neutral-200 bg-white p-4">
          {selectedBlock ? <BlockInspector block={selectedBlock} locale={locale} media={media} onChange={(recipe) => mutate((next) => { const target = findBlock(next.pages[page].blocks, selectedBlock.id); if (target) recipe(target); })} onDelete={removeBlock} onUpload={(event) => void upload(event, 'image')} /> : <ThemeInspector document={document} locale={locale} media={media} mutate={mutate} onUpload={upload} />}
        </aside>
      </div>
    </div>
  );
}

function SortableCanvasBlock({ block, document, page, locale, slots, selected, onSelect }: { block: StorefrontBlock; document: StorefrontDocument; page: StorefrontPageKind; locale: StorefrontLocale; slots: StorefrontSlots; selected: string | null; onSelect: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const scoped = useMemo(() => ({ ...document, pages: { ...document.pages, [page]: { ...document.pages[page], blocks: [block] } } }), [block, document, page]);
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group relative', isDragging && 'z-20 opacity-60')}><button {...attributes} {...listeners} title="Kéo để sắp xếp" className="absolute right-2 top-2 z-20 flex h-7 w-7 cursor-grab items-center justify-center rounded border border-neutral-200 bg-white/90 text-neutral-500 opacity-0 shadow-sm group-hover:opacity-100 focus:opacity-100"><GripVertical className="h-4 w-4" /></button><StorefrontRenderer document={scoped} page={page} locale={locale} slots={slots} selectedId={selected} onSelect={onSelect} /></div>;
}

function Palette({ title, blocks, onAdd }: { title: string; blocks: StorefrontBlockType[]; onAdd: (type: StorefrontBlockType) => void }) {
  return <div className="mb-5"><p className="mb-2 text-xs font-semibold uppercase text-neutral-400">{title}</p><div className="grid grid-cols-2 gap-1.5">{blocks.map((type) => { const Icon = blockIcon(type); return <button key={type} onClick={() => onAdd(type)} className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-2 text-[11px] text-neutral-600 hover:border-neutral-400 hover:text-neutral-950"><Icon className="h-4 w-4" /><span>{LABELS[type]}</span></button>; })}</div></div>;
}

function ThemeInspector({ document, locale, media, mutate, onUpload }: { document: StorefrontDocument; locale: StorefrontLocale; media: StoreMediaAssetDto[]; mutate: (recipe: (next: StorefrontDocument) => void) => void; onUpload: (event: ChangeEvent<HTMLInputElement>, target: 'logo' | 'favicon' | 'image') => void }) {
  return <div className="space-y-5"><div><h2 className="font-semibold">Thương hiệu & theme</h2><p className="mt-1 text-xs text-neutral-500">Chưa chọn block; đang chỉnh thiết lập toàn trang.</p></div><Field label="Tên cửa hàng"><Input value={document.brand.name} onChange={(event) => mutate((next) => { next.brand.name = event.target.value; })} /></Field><Field label="Tên ngắn"><Input value={document.brand.shortName} onChange={(event) => mutate((next) => { next.brand.shortName = event.target.value; })} /></Field><Field label={`Tagline · ${locale.toUpperCase()}`}><Input value={document.brand.tagline[locale]} onChange={(event) => mutate((next) => { next.brand.tagline[locale] = event.target.value; })} /></Field><div className="grid grid-cols-2 gap-2"><UploadField label="Logo" current={document.brand.logoAssetId} media={media} onChange={(id) => mutate((next) => { next.brand.logoAssetId = id; })} onUpload={(event) => onUpload(event, 'logo')} /><UploadField label="Favicon" current={document.brand.faviconAssetId} media={media} onChange={(id) => mutate((next) => { next.brand.faviconAssetId = id; })} onUpload={(event) => onUpload(event, 'favicon')} /></div><div className="grid grid-cols-2 gap-3 border-t border-neutral-200 pt-4"><Field label="Preset"><select value={document.theme.preset} onChange={(event) => mutate((next) => applyPreset(next, event.target.value as StorefrontDocument['theme']['preset']))} className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"><option value="minimal">Minimal</option><option value="commerce">Commerce</option><option value="compact">Compact</option></select></Field><Field label="Kiểu nút"><select value={document.theme.buttonStyle} onChange={(event) => mutate((next) => { next.theme.buttonStyle = event.target.value as StorefrontDocument['theme']['buttonStyle']; })} className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"><option value="solid">Solid</option><option value="outline">Outline</option><option value="soft">Soft</option></select></Field><Field label="Font tiêu đề"><FontSelect value={document.theme.headingFont} onChange={(value) => mutate((next) => { next.theme.headingFont = value; })} /></Field><Field label="Font nội dung"><FontSelect value={document.theme.bodyFont} onChange={(value) => mutate((next) => { next.theme.bodyFont = value; })} /></Field></div><div className="border-t border-neutral-200 pt-4"><p className="mb-3 text-xs font-semibold uppercase text-neutral-400">Màu</p><div className="grid grid-cols-2 gap-3">{Object.entries(document.theme.colors).map(([key, value]) => <label key={key} className="text-[11px] text-neutral-500"><span className="mb-1 block truncate">{key}</span><div className="flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-2"><input type="color" value={value} onChange={(event) => mutate((next) => { next.theme.colors[key as keyof typeof next.theme.colors] = event.target.value; })} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-[10px]">{value}</span></div></label>)}</div></div><Field label={`Độ bo · ${document.theme.radius}px`}><input type="range" min="0" max="16" value={document.theme.radius} onChange={(event) => mutate((next) => { next.theme.radius = Number(event.target.value); })} className="w-full accent-neutral-950" /></Field><Field label={`Độ rộng · ${document.theme.containerWidth}px`}><input type="range" min="960" max="1600" step="16" value={document.theme.containerWidth} onChange={(event) => mutate((next) => { next.theme.containerWidth = Number(event.target.value); })} className="w-full accent-neutral-950" /></Field><Field label="Mật độ"><select value={document.theme.density} onChange={(event) => mutate((next) => { next.theme.density = event.target.value as StorefrontDocument['theme']['density']; })} className="h-10 w-full rounded-md border border-neutral-300 px-3 text-sm"><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></Field></div>;
}

function applyPreset(document: StorefrontDocument, preset: StorefrontDocument['theme']['preset']): void {
  document.theme.preset = preset;
  if (preset === 'minimal') Object.assign(document.theme, { radius: 6, density: 'comfortable', buttonStyle: 'solid', containerWidth: 1152, colors: { ...document.theme.colors, background: '#ffffff', surface: '#ffffff', foreground: '#0a0a0a', muted: '#737373', primary: '#0a0a0a', primaryForeground: '#ffffff', border: '#e5e5e5' } });
  if (preset === 'commerce') Object.assign(document.theme, { radius: 8, density: 'comfortable', buttonStyle: 'solid', containerWidth: 1200, colors: { ...document.theme.colors, background: '#f7f7f8', surface: '#ffffff', foreground: '#171717', muted: '#666666', primary: '#0f766e', primaryForeground: '#ffffff', border: '#dedede', success: '#15803d', danger: '#dc2626' } });
  if (preset === 'compact') Object.assign(document.theme, { radius: 4, density: 'compact', buttonStyle: 'outline', containerWidth: 1280, colors: { ...document.theme.colors, background: '#ffffff', surface: '#ffffff', foreground: '#111827', muted: '#6b7280', primary: '#111827', primaryForeground: '#ffffff', border: '#d1d5db' } });
}

function FontSelect({ value, onChange }: { value: StorefrontDocument['theme']['bodyFont']; onChange: (value: StorefrontDocument['theme']['bodyFont']) => void }) {
  return <select value={value} onChange={(event) => onChange(event.target.value as StorefrontDocument['theme']['bodyFont'])} className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"><option value="geist">Geist</option><option value="system-sans">System sans</option><option value="system-serif">System serif</option><option value="system-mono">System mono</option></select>;
}

function BlockInspector({ block, locale, media, onChange, onDelete, onUpload }: { block: StorefrontBlock; locale: StorefrontLocale; media: StoreMediaAssetDto[]; onChange: (recipe: (block: StorefrontBlock) => void) => void; onDelete: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const locked = (STOREFRONT_BUSINESS_BLOCKS as readonly string[]).includes(block.type);
  const textType = ['heading', 'banner', 'features', 'faq', 'contact'].includes(block.type);
  return <div className="space-y-5"><div className="flex items-start justify-between gap-2"><div><p className="text-xs uppercase text-neutral-400">Block</p><h2 className="font-semibold">{LABELS[block.type] ?? block.type}</h2><p className="mt-1 font-mono text-[10px] text-neutral-400">{block.id}</p></div>{locked && <Badge variant="muted">Khóa logic</Badge>}</div>{textType && <><Field label={`Tiêu đề · ${locale.toUpperCase()}`}><Input value={localizedValue(block, 'title', locale)} onChange={(event) => onChange((target) => setLocalized(target, 'title', locale, event.target.value))} /></Field><Field label={`Nội dung · ${locale.toUpperCase()}`}><textarea value={localizedValue(block, 'body', locale)} onChange={(event) => onChange((target) => setLocalized(target, 'body', locale, event.target.value))} className="min-h-24 w-full rounded-md border border-neutral-300 p-3 text-sm" /></Field></>}{block.type === 'richText' && <Field label={`HTML đã lọc · ${locale.toUpperCase()}`}><textarea value={localizedValue(block, 'html', locale)} onChange={(event) => onChange((target) => setLocalized(target, 'html', locale, event.target.value))} className="min-h-40 w-full rounded-md border border-neutral-300 p-3 font-mono text-xs" /></Field>}{block.type === 'heading' && <Field label="Cấp heading"><select value={Number(block.props.level ?? 2)} onChange={(event) => onChange((target) => { target.props.level = Number(event.target.value); })} className="h-10 w-full rounded-md border border-neutral-300 px-3"><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option><option value="4">H4</option></select></Field>}{block.type === 'image' && <><Field label="Media"><select value={typeof block.props.assetId === 'string' ? block.props.assetId : ''} onChange={(event) => onChange((target) => { target.props.assetId = event.target.value || null; })} className="h-10 w-full rounded-md border border-neutral-300 px-2 text-sm"><option value="">Chọn ảnh</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.id.slice(-8)} · {asset.width}×{asset.height}</option>)}</select></Field><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm"><Upload className="h-4 w-4" />Tải ảnh<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onUpload} /></label></>}{['section', 'grid', 'columns', 'stack', 'spacer'].includes(block.type) && <Field label="Khoảng cách (px)"><Input type="number" min="0" max="160" value={Number(block.props.gap ?? block.props.height ?? block.props.paddingY ?? 24)} onChange={(event) => onChange((target) => { const key = target.type === 'spacer' ? 'height' : target.type === 'section' ? 'paddingY' : 'gap'; target.props[key] = Number(event.target.value); })} /></Field>}{!locked && <Button variant="danger" className="w-full" onClick={onDelete}><Trash2 className="h-4 w-4" />Xóa block</Button>}</div>;
}

function UploadField({ label, current, media, onChange, onUpload }: { label: string; current: string | null; media: StoreMediaAssetDto[]; onChange: (id: string | null) => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <div><p className="mb-1.5 text-xs font-medium">{label}</p><label className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50">{current ? <img src={`${apiBaseUrl()}/storefront/media/${current}`} alt="" className="h-full w-full object-contain" /> : <Upload className="h-4 w-4 text-neutral-400" />}<input type="file" accept="image/png,image/jpeg,image/webp" className="absolute inset-0 cursor-pointer opacity-0" onChange={onUpload} /></label><select value={current ?? ''} onChange={(event) => onChange(event.target.value || null)} className="mt-1 h-8 w-full rounded border border-neutral-200 px-1 text-[10px]"><option value="">Chưa chọn</option>{media.map((asset) => <option key={asset.id} value={asset.id}>{asset.id.slice(-8)}</option>)}</select></div>;
}

function defaultBlock(type: StorefrontBlockType, locale: StorefrontLocale): StorefrontBlock {
  const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const props: Record<string, unknown> = {};
  if (type === 'heading') Object.assign(props, { level: 2, text: { vi: 'Tiêu đề mới', en: 'New heading', zh: '新标题' } });
  if (type === 'richText') Object.assign(props, { html: { vi: '<p>Nội dung mới.</p>', en: '<p>New content.</p>', zh: '<p>新内容。</p>' } });
  if (['banner', 'features', 'faq', 'contact'].includes(type)) Object.assign(props, { title: { vi: 'Tiêu đề', en: 'Title', zh: '标题' }, body: { vi: 'Nội dung', en: 'Content', zh: '内容' } });
  if (type === 'section') props.paddingY = 32;
  if (type === 'grid') Object.assign(props, { columns: 3, gap: 20 });
  if (type === 'columns') props.gap = 24;
  if (type === 'stack') props.gap = 16;
  if (type === 'spacer') props.height = 32;
  if (type === 'image') props.alt = { vi: '', en: '', zh: '' };
  void locale;
  return { id, type, props, ...(PARENT_BLOCKS.has(type) ? { children: [] } : {}) };
}

function findBlock(blocks: StorefrontBlock[], id: string): StorefrontBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    const nested = block.children ? findBlock(block.children, id) : null;
    if (nested) return nested;
  }
  return null;
}

function removeBlockById(blocks: StorefrontBlock[], id: string): StorefrontBlock[] {
  return blocks.filter((block) => block.id !== id).map((block) => block.children ? { ...block, children: removeBlockById(block.children, id) } : block);
}

function previewSlots(products: ProductDto[]): StorefrontSlots {
  const placeholder = (title: string, body: string) => <div className="mx-auto w-full max-w-3xl px-4 py-10"><div className="border-y border-[var(--store-border)] py-8"><p className="text-xs font-semibold uppercase text-[var(--store-muted)]">Block nghiệp vụ</p><h3 className="mt-2 text-xl font-semibold">{title}</h3><p className="mt-2 text-sm text-[var(--store-muted)]">{body}</p></div></div>;
  return {
    productBrowser: <div className="pointer-events-none select-none">{products.length > 0 ? <div className="mx-auto max-w-6xl px-4 py-8"><ProductBrowser products={products} /></div> : placeholder('Danh sách sản phẩm', 'Dữ liệu sản phẩm thật sẽ xuất hiện tại đây.')}</div>,
    productDetail: <div className="pointer-events-none select-none">{products[0] ? <div className="mx-auto max-w-6xl px-4 py-8"><ProductDetail product={products[0]} /></div> : placeholder('Chi tiết sản phẩm', 'Chọn hoặc tạo sản phẩm để xem preview thật.')}</div>,
    loginForm: placeholder('Đăng nhập', 'Form email, mật khẩu và liên kết hỗ trợ.'), registerForm: placeholder('Đăng ký', 'Form tài khoản và captcha.'), checkoutPanel: placeholder('Thanh toán', 'Sản phẩm, số lượng, mã giảm giá và phương thức thanh toán.'), ordersList: placeholder('Đơn hàng của tôi', 'Danh sách đơn theo tài khoản khách.'), orderDetailPanel: placeholder('Trạng thái đơn', 'Thanh toán, tiến trình và key đã giao.'), accountPanel: placeholder('Tài khoản', 'Thông tin khách và bảo mật.'), legalContent: placeholder('Nội dung chính sách', 'Điều khoản đã được sanitize.'), maintenanceMessage: placeholder('Đang thiết lập', 'Thông báo maintenance cho khách.'),
  };
}

function blockIcon(type: StorefrontBlockType) { if (type === 'heading') return Type; if (type === 'image') return ImageIcon; if (type === 'grid') return LayoutGrid; if (type === 'columns') return Columns3; if (type === 'stack') return Rows3; if (type === 'section' || type === 'container') return PanelTop; return AlignLeft; }
function statusLabel(status: 'saved' | 'saving' | 'dirty' | 'error') { return status === 'saved' ? 'Đã lưu' : status === 'saving' ? 'Đang lưu…' : status === 'dirty' ? 'Chưa lưu' : 'Lỗi lưu'; }
function localizedValue(block: StorefrontBlock, key: string, locale: StorefrontLocale): string { const value = block.props[key]; if (value && typeof value === 'object' && !Array.isArray(value)) { const exact = (value as Record<string, unknown>)[locale]; return typeof exact === 'string' ? exact : ''; } return typeof value === 'string' ? value : ''; }
function setLocalized(block: StorefrontBlock, key: string, locale: StorefrontLocale, value: string) { const current = block.props[key]; const row = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : { vi: '', en: '', zh: '' }; row[locale] = value; block.props[key] = row; }

async function validateAndReadImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Chỉ nhận PNG, JPEG hoặc WebP.');
  if (file.size > 1_000_000) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 1 MB.');
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Không đọc được ảnh.')); reader.readAsDataURL(file); });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Ảnh không hợp lệ.')); image.src = data; });
  if (dimensions.width > 2400 || dimensions.height > 2400) throw new Error('Ảnh tối đa 2400×2400 px.');
  return data;
}
