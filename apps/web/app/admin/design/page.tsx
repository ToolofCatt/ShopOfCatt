'use client';

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlignLeft, Columns3, GripVertical, Image as ImageIcon, LayoutGrid, Monitor, PanelTop, Redo2, Rocket, Rows3, Save, Smartphone, Type, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react';
import {
  STOREFRONT_LOCALES, STOREFRONT_PAGE_KINDS,
  type AnnouncementDto, type ProductDto, type StoreMediaAssetDto, type StorefrontBlock, type StorefrontBlockType,
  type StorefrontDocument, type StorefrontDraftDto, type StorefrontLocale, type StorefrontPageKind, type StorefrontRevisionDto,
} from '@webcatt/shared';
import { AnnouncementCard } from '@/components/announcement-card';
import { ProductBrowser } from '@/components/product-browser';
import { ProductDetail } from '@/components/product-detail';
import { StorefrontRenderer, type StorefrontSlots } from '@/components/storefront/storefront-renderer';
import { Button, Spinner } from '@/components/ui';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BuilderDraftSession } from '@/lib/builder-draft';
import { builderBlockLocked } from '@/lib/builder-document';
import { BuilderBlockInspector, BuilderThemeInspector } from '@/lib/builder-inspector';
import { cn } from '@/lib/cn';
import { getDictionary } from '@/lib/i18n';
import { PreviewI18nProvider, useI18n } from '@/lib/i18n/client';
import type { BuilderUx } from '@/lib/i18n/dictionaries/builder-ux';
import { themeVariables } from '@/lib/storefront';
import { PreviewContent } from '@/lib/preview-content';

const LAYOUT_BLOCKS: StorefrontBlockType[] = ['section', 'container', 'grid', 'columns', 'stack', 'divider', 'spacer'];
const CONTENT_BLOCKS: StorefrontBlockType[] = ['heading', 'richText', 'image', 'banner', 'features', 'faq', 'contact'];
const PARENT_BLOCKS = new Set<StorefrontBlockType>(['section', 'container', 'grid', 'columns', 'stack']);

export default function DesignPage() {
  const { token, user } = useAuth();
  const { locale: adminLocale, t, formatDate } = useI18n();
  const copy = t.builderUx;
  const session = useRef(new BuilderDraftSession()).current;
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const { document, version, dirty, status } = session;
  const saving = status === 'saving';
  const [page, setPage] = useState<StorefrontPageKind>('home');
  const [locale, setLocale] = useState<StorefrontLocale>('vi');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [selected, setSelected] = useState<string | null>(null);
  const [media, setMedia] = useState<StoreMediaAssetDto[]>([]);
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [announcement, setAnnouncement] = useState<AnnouncementDto | null>(null);
  const [revisions, setRevisions] = useState<StorefrontRevisionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<StorefrontDocument[]>([]);
  const [future, setFuture] = useState<StorefrontDocument[]>([]);
  const operation = useRef(false);
  const loadGeneration = useRef(0);
  // Đổi ngôn ngữ quản trị chỉ đổi chữ, không tải lại rồi đè lên bản nháp đang sửa.
  const requestContext = useRef({ adminLocale, connectionError: t.common.connectionError });
  requestContext.current = { adminLocale, connectionError: t.common.connectionError };
  const canPublish = user?.role === 'SUPERADMIN';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    if (!token) return;
    const generation = ++loadGeneration.current;
    const context = requestContext.current;
    setLoading(true); setLoadError(null);
    try {
      const [draft, assets, savedRevisions] = await Promise.all([
        apiFetch<StorefrontDraftDto>('/admin/storefront/draft', { token, locale: context.adminLocale }),
        apiFetch<StoreMediaAssetDto[]>('/admin/storefront/media', { token, locale: context.adminLocale }),
        apiFetch<StorefrontRevisionDto[]>('/admin/storefront/revisions', { token, locale: context.adminLocale }),
      ]);
      if (generation !== loadGeneration.current) return;
      session.load(draft); refresh();
      setMedia(assets); setRevisions(savedRevisions); setMessage(null);
      setHistory([]); setFuture([]); setSelected(null);
    } catch (error) {
      if (generation === loadGeneration.current) setLoadError(apiErrorMessage(error, context.connectionError));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [session, token]);

  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);
  useEffect(() => {
    let current = true;
    void Promise.all([
      apiFetch<ProductDto[]>('/products', { locale }).catch(() => []),
      apiFetch<AnnouncementDto>('/announcement', { locale }).catch(() => null),
    ]).then(([nextProducts, nextAnnouncement]) => {
      if (!current) return;
      setProducts(nextProducts); setAnnouncement(nextAnnouncement);
    });
    return () => { current = false; };
  }, [locale]);

  const save = useCallback(async (manual = false): Promise<boolean> => {
    if (!token || operation.current) return false;
    const ticket = session.beginSave(manual);
    if (!ticket) return !session.dirty;
    refresh();
    const context = requestContext.current;
    try {
      const result = await apiFetch<StorefrontDraftDto>('/admin/storefront/draft', { method: 'PUT', token, locale: context.adminLocale, body: { version: ticket.version, document: ticket.document } });
      const unchanged = session.acceptSave(ticket, result);
      setMessage(null); return unchanged;
    } catch (error) {
      session.rejectSave(ticket, error instanceof ApiError ? error.status : 0);
      setMessage(apiErrorMessage(error, context.connectionError)); return false;
    } finally { refresh(); }
  }, [session, token]);

  useEffect(() => {
    if (!dirty || status !== 'dirty' || loading || publishing) return;
    const timer = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer);
  }, [dirty, document, loading, publishing, save, status]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const mutate = useCallback((recipe: (next: StorefrontDocument) => void) => {
    const current = session.document;
    if (!current || operation.current) return;
    const next = structuredClone(current); recipe(next);
    setHistory((rows) => [...rows.slice(-39), structuredClone(current)]); setFuture([]);
    session.edit(next); refresh();
  }, [session]);

  const undo = () => {
    const previous = history.at(-1); if (!previous || !document || operation.current) return;
    setFuture((rows) => [structuredClone(document), ...rows].slice(0, 40)); setHistory((rows) => rows.slice(0, -1));
    session.edit(structuredClone(previous)); refresh();
  };
  const redo = () => {
    const next = future[0]; if (!next || !document || operation.current) return;
    setHistory((rows) => [...rows, structuredClone(document)].slice(-40)); setFuture((rows) => rows.slice(1));
    session.edit(structuredClone(next)); refresh();
  };

  const addBlock = (type: StorefrontBlockType) => mutate((next) => {
    const block = defaultBlock(type);
    const parent = selected ? findBlock(next.pages[page].blocks, selected) : null;
    if (parent && PARENT_BLOCKS.has(parent.type)) { parent.children ??= []; parent.children.push(block); }
    else next.pages[page].blocks.push(block);
    setSelected(block.id);
  });
  const removeBlock = () => {
    if (!selected || !document) return;
    const block = findBlock(document.pages[page].blocks, selected);
    if (!block || builderBlockLocked(block)) return;
    mutate((next) => { next.pages[page].blocks = removeBlockById(next.pages[page].blocks, selected); }); setSelected(null);
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
    if (!token || !canPublish || operation.current || session.dirty || session.status !== 'saved') return;
    operation.current = true; setPublishing(true); setMessage(null);
    try {
      await apiFetch('/admin/storefront/publish', { method: 'POST', token, locale: adminLocale });
      setRevisions(await apiFetch<StorefrontRevisionDto[]>('/admin/storefront/revisions', { token, locale: adminLocale }));
      setMessage(copy.published);
    } catch (error) { setMessage(apiErrorMessage(error, t.common.connectionError)); }
    finally { operation.current = false; setPublishing(false); }
  };
  const restore = async (id: string) => {
    if (!token || !canPublish || operation.current || session.dirty || session.status !== 'saved' || !window.confirm(copy.restoreConfirm)) return;
    operation.current = true; setPublishing(true);
    try {
      await apiFetch(`/admin/storefront/revisions/${id}/restore`, { method: 'POST', token, locale: adminLocale });
      await load(); setMessage(copy.restored);
    } catch (error) { setMessage(apiErrorMessage(error, t.common.connectionError)); }
    finally { operation.current = false; setPublishing(false); }
  };
  const reload = () => {
    if (saving || operation.current || (session.dirty && !window.confirm(copy.reloadConfirm))) return;
    void load();
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>, target: 'logo' | 'favicon' | 'image' = 'image') => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || !token || operation.current) return;
    try {
      const data = await validateAndReadImage(file, copy);
      const asset = await apiFetch<StoreMediaAssetDto>('/admin/storefront/media', { method: 'POST', token, locale: adminLocale, body: { data } });
      setMedia((rows) => [asset, ...rows]);
      mutate((next) => {
        if (target === 'logo') next.brand.logoAssetId = asset.id;
        else if (target === 'favicon') next.brand.faviconAssetId = asset.id;
        else if (selected) { const block = findBlock(next.pages[page].blocks, selected); if (block?.type === 'image') block.props.assetId = asset.id; }
      });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  if (!document) return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4">{loadError ? <><p role="alert" className="text-sm text-red-600">{loadError}</p><Button variant="outline" onClick={() => void load()}>{copy.retry}</Button></> : <><Spinner className="h-6 w-6 text-neutral-400" /><p role="status" className="text-sm text-neutral-500">{copy.loading}</p></>}</div>;
  const blocks = document.pages[page].blocks;
  const selectedBlock = selected ? findBlock(blocks, selected) : null;
  const previewDictionary = getDictionary(locale);
  const slots = previewSlots(products, announcement, previewDictionary.home.announcementLabel, previewDictionary.builderUx);
  const blocked = !canPublish || saving || dirty || loading || publishing || status !== 'saved';

  return <div className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-neutral-100 lg:-mx-8">
    <header className="sticky top-16 z-30 border-b border-neutral-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="mr-2"><h1 className="text-lg font-semibold">{copy.title}</h1><p role="status" aria-live="polite" className="text-xs text-neutral-500">{copy.draft} v{version} · {copy[status]}</p></div>
        <div><label htmlFor="builder-page" className="mb-1 block text-xs text-neutral-600">{copy.page}</label><select id="builder-page" value={page} onChange={(event) => { setPage(event.target.value as StorefrontPageKind); setSelected(null); }} className="h-11 max-w-full rounded-md border border-neutral-300 bg-white px-2 text-sm">{STOREFRONT_PAGE_KINDS.map((kind) => <option key={kind} value={kind}>{copy.pages[kind]}</option>)}</select></div>
        <fieldset aria-describedby="builder-locale-hint"><legend className="mb-1 text-xs text-neutral-600">{copy.contentLocale}</legend><div className="flex h-11 rounded-md border border-neutral-300 p-0.5">{STOREFRONT_LOCALES.map((entry) => <button type="button" key={entry} aria-pressed={locale === entry} onClick={() => setLocale(entry)} className={cn('min-w-11 rounded px-2 text-xs font-semibold uppercase focus-visible:outline focus-visible:outline-2', locale === entry && 'bg-neutral-950 text-white')}>{entry}</button>)}</div></fieldset>
        <div className="flex h-11 rounded-md border border-neutral-300 p-0.5"><button type="button" aria-label={copy.desktop} title={copy.desktop} aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')} className={cn('min-w-11 rounded px-2 focus-visible:outline focus-visible:outline-2', device === 'desktop' && 'bg-neutral-950 text-white')}><Monitor aria-hidden="true" className="mx-auto h-4 w-4" /></button><button type="button" aria-label={copy.mobile} title={copy.mobile} aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')} className={cn('min-w-11 rounded px-2 focus-visible:outline focus-visible:outline-2', device === 'mobile' && 'bg-neutral-950 text-white')}><Smartphone aria-hidden="true" className="mx-auto h-4 w-4" /></button></div>
        <div className="ml-auto flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={history.length === 0 || loading || publishing} onClick={undo} aria-label={copy.undo} title={copy.undo}><Undo2 aria-hidden="true" className="h-4 w-4" /></Button><Button variant="ghost" size="sm" disabled={future.length === 0 || loading || publishing} onClick={redo} aria-label={copy.redo} title={copy.redo}><Redo2 aria-hidden="true" className="h-4 w-4" /></Button><Button variant="outline" size="sm" loading={saving} disabled={!dirty || loading || publishing || status === 'conflict'} onClick={() => void save(true)}><Save aria-hidden="true" className="h-4 w-4" />{copy.save}</Button><Button size="sm" loading={publishing} disabled={blocked} aria-describedby="builder-publish-hint" onClick={() => void publish()}><Rocket aria-hidden="true" className="h-4 w-4" />{copy.publish}</Button></div>
      </div>
      <p id="builder-locale-hint" className="mt-2 text-xs text-neutral-500">{copy.localeHint}</p>
      <p id="builder-publish-hint" className="mt-1 text-xs text-neutral-500">{!canPublish ? copy.ownerOnly : copy.saveBeforePublish}</p>
      {(status === 'conflict' || status === 'error') && <div role="alert" className="mt-2 rounded-md border border-neutral-300 p-3 text-sm"><p>{status === 'conflict' ? copy.conflictHint : copy.errorHint}</p><Button variant="outline" size="sm" className="mt-2" disabled={loading} onClick={reload}>{copy.reload}</Button></div>}
      {loadError && <p role="alert" className="mt-2 text-xs text-red-600">{loadError}</p>}
      {message && <p role="status" className="mt-2 text-xs text-neutral-600">{message}</p>}
    </header>

    <fieldset disabled={publishing || loading} className="grid min-w-0 min-h-[calc(100vh-8.5rem)] grid-cols-1 xl:grid-cols-[13rem_minmax(0,1fr)_19rem]">
      <aside className="min-w-0 border-r border-neutral-200 bg-white p-3">
        <Palette title={copy.layout} blocks={LAYOUT_BLOCKS} onAdd={addBlock} />
        <Palette title={copy.content} blocks={CONTENT_BLOCKS} onAdd={addBlock} />
        <Button variant="outline" size="sm" className="w-full" onClick={() => setSelected(null)}>{copy.backToTheme}</Button>
        <div className="mt-5 border-t border-neutral-200 pt-4"><h2 className="mb-2 text-xs font-semibold uppercase text-neutral-500">{copy.revisions}</h2>{revisions.length === 0 && <p className="text-xs text-neutral-500">{copy.noRevisions}</p>}{revisions.slice(0, 5).map((revision) => <button type="button" key={revision.id} disabled={blocked} aria-label={`${copy.restore} v${revision.version}`} aria-describedby="builder-publish-hint" onClick={() => void restore(revision.id)} className="flex min-h-11 w-full items-center justify-between gap-2 py-1.5 text-left text-xs text-neutral-600 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"><span>v{revision.version}</span><time dateTime={revision.publishedAt}>{formatDate(revision.publishedAt)}</time></button>)}</div>
      </aside>
      <section aria-label={copy.canvas} className="min-w-0 p-4 sm:p-8">
        <p className="mb-3 text-xs text-neutral-600">{copy.previewHint}</p>
        <div data-storefront-preview data-store-preset={document.theme.preset} data-store-button-style={document.theme.buttonStyle} data-store-density={document.theme.density} className={cn('mx-auto min-h-[680px] overflow-hidden bg-white shadow-sm', device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full max-w-[1180px]')} style={themeVariables(document.theme)}>
          <div className="border-b border-[var(--store-border)] bg-[var(--store-surface)] px-4 py-3 text-xs text-[var(--store-muted)]"><strong className="text-[var(--store-foreground)]">{document.brand.name}</strong> · {copy.pages[page]} · {locale.toUpperCase()}</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>{blocks.map((block) => <SortableCanvasBlock key={block.id} block={block} document={document} page={page} locale={locale} slots={slots} selected={selected} onSelect={setSelected} />)}</SortableContext></DndContext>
        </div>
      </section>
      <aside className="min-w-0 border-l border-neutral-200 bg-white p-4">{selectedBlock ? <BuilderBlockInspector block={selectedBlock} locale={locale} media={media} onChange={(recipe) => mutate((next) => { const target = findBlock(next.pages[page].blocks, selectedBlock.id); if (target) recipe(target); })} onDelete={removeBlock} onUpload={(event) => void upload(event, 'image')} /> : <BuilderThemeInspector document={document} locale={locale} media={media} mutate={mutate} onUpload={upload} />}</aside>
    </fieldset>
  </div>;
}

function SortableCanvasBlock({ block, document, page, locale, slots, selected, onSelect }: { block: StorefrontBlock; document: StorefrontDocument; page: StorefrontPageKind; locale: StorefrontLocale; slots: StorefrontSlots; selected: string | null; onSelect: (id: string) => void }) {
  const { t: { builderUx: copy } } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const scoped = useMemo(() => ({ ...document, pages: { ...document.pages, [page]: { ...document.pages[page], blocks: [block] } } }), [block, document, page]);
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group relative', isDragging && 'z-20 opacity-60')}><button type="button" {...attributes} {...listeners} aria-label={`${copy.reorder} · ${copy.blocks[block.type as keyof typeof copy.blocks] ?? block.type}`} title={copy.reorder} className="absolute right-2 top-2 z-20 flex h-9 w-9 cursor-grab items-center justify-center rounded border border-neutral-200 bg-white/90 text-neutral-500 opacity-0 shadow-sm group-hover:opacity-100 focus:opacity-100"><GripVertical aria-hidden="true" className="h-4 w-4" /></button><PreviewI18nProvider locale={locale}><StorefrontRenderer document={scoped} page={page} locale={locale} slots={slots} selectedId={selected} onSelect={onSelect} /></PreviewI18nProvider></div>;
}
function Palette({ title, blocks, onAdd }: { title: string; blocks: StorefrontBlockType[]; onAdd: (type: StorefrontBlockType) => void }) {
  const { t: { builderUx: copy } } = useI18n();
  return <div className="mb-5"><h2 className="mb-2 text-xs font-semibold uppercase text-neutral-500">{title}</h2><div className="grid grid-cols-2 gap-1.5">{blocks.map((type) => { const Icon = blockIcon(type); return <button type="button" key={type} onClick={() => onAdd(type)} className="flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-2 text-[11px] text-neutral-600 hover:border-neutral-400 hover:text-neutral-950"><Icon aria-hidden="true" className="h-4 w-4" /><span>{copy.blocks[type as keyof typeof copy.blocks]}</span></button>; })}</div></div>;
}
function defaultBlock(type: StorefrontBlockType): StorefrontBlock {
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
  return { id, type, props, ...(PARENT_BLOCKS.has(type) ? { children: [] } : {}) };
}
function findBlock(blocks: StorefrontBlock[], id: string): StorefrontBlock | null {
  for (const block of blocks) { if (block.id === id) return block; const nested = block.children ? findBlock(block.children, id) : null; if (nested) return nested; } return null;
}
function removeBlockById(blocks: StorefrontBlock[], id: string): StorefrontBlock[] { return blocks.filter((block) => block.id !== id).map((block) => block.children ? { ...block, children: removeBlockById(block.children, id) } : block); }
function previewSlots(products: ProductDto[], announcement: AnnouncementDto | null, announcementLabel: string, copy: BuilderUx): StorefrontSlots {
  const placeholder = (title: string, body: string) => <div className="mx-auto w-full max-w-3xl px-4 py-10"><div className="border-y border-[var(--store-border)] py-8"><p className="text-xs font-semibold uppercase text-[var(--store-muted)]">{copy.previews.business}</p><h3 className="mt-2 text-xl font-semibold">{title}</h3><p className="mt-2 text-sm text-[var(--store-muted)]">{body}</p></div></div>;
  return {
    announcement: <PreviewContent>{announcement?.active ? <AnnouncementCard announcement={announcement} label={announcementLabel} /> : placeholder(announcementLabel, copy.previews.announcement)}</PreviewContent>,
    productBrowser: <PreviewContent>{products.length > 0 ? <div className="mx-auto max-w-6xl px-4 py-8"><ProductBrowser products={products} /></div> : placeholder(copy.pages.product, copy.previews.products)}</PreviewContent>,
    productDetail: <PreviewContent>{products[0] ? <div className="mx-auto max-w-6xl px-4 py-8"><ProductDetail product={products[0]} preview /></div> : placeholder(copy.pages.product, copy.previews.product)}</PreviewContent>,
    loginForm: placeholder(copy.pages.login, copy.previews.login), registerForm: placeholder(copy.pages.register, copy.previews.register), checkoutPanel: placeholder(copy.pages.checkout, copy.previews.checkout), ordersList: placeholder(copy.pages.orders, copy.previews.orders), orderDetailPanel: placeholder(copy.pages.orderDetail, copy.previews.orderDetail), accountPanel: placeholder(copy.pages.account, copy.previews.account), legalContent: placeholder(copy.pages.legal, copy.previews.legal), maintenanceMessage: placeholder(copy.pages.maintenance, copy.previews.maintenance),
  };
}
function blockIcon(type: StorefrontBlockType) { if (type === 'heading') return Type; if (type === 'image') return ImageIcon; if (type === 'grid') return LayoutGrid; if (type === 'columns') return Columns3; if (type === 'stack') return Rows3; if (type === 'section' || type === 'container') return PanelTop; return AlignLeft; }
async function validateAndReadImage(file: File, copy: BuilderUx): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(copy.imageType);
  if (file.size > 1_000_000) throw new Error(copy.imageSize);
  const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error(copy.imageRead)); reader.readAsDataURL(file); });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error(copy.imageInvalid)); image.src = data; });
  if (dimensions.width > 2400 || dimensions.height > 2400) throw new Error(copy.imageDimensions);
  return data;
}
