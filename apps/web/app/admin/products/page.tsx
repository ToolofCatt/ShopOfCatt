'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  ServerCrash,
  Trash2,
  X,
} from 'lucide-react';
import { LOW_STOCK_THRESHOLD, type ProductDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { ProductVisual } from '@/components/icon-map';
import { PageHeader } from '@/components/admin/page-header';
import { Tabs, type TabItem } from '@/components/admin/tabs';
import { formatProductPrice } from '@/components/admin/helpers';

const ICON_BUTTON_CLASSES =
  'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:pointer-events-none disabled:opacity-50';

const VIEW_STORAGE_KEY = 'wc_admin_products_view';

type StatusFilter = 'ALL' | 'ACTIVE' | 'HIDDEN';
type SortKey = 'NEWEST' | 'NAME' | 'STOCK_ASC' | 'SOLD_DESC';
type ViewMode = 'grid' | 'table';

export default function AdminProductsPage() {
  const { token } = useAuth();
  const { t } = useI18n();

  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<SortKey>('NEWEST');
  const [view, setView] = useState<ViewMode>('grid');

  // Nhớ kiểu xem đã chọn giữa các lần vào trang.
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'grid' || stored === 'table') setView(stored);
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  useEffect(() => {
    let active = true;
    apiFetch<ProductDto[]>('/admin/products', { token })
      .then((data) => {
        if (active) setProducts(data);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  const toggleActive = async (product: ProductDto) => {
    if (busyId) return;
    setBusyId(product.id);
    try {
      const updated = await apiFetch<ProductDto>(`/admin/products/${product.id}`, {
        method: 'PATCH',
        body: { active: !product.active },
        token,
      });
      setProducts((current) =>
        current ? current.map((item) => (item.id === product.id ? updated : item)) : current,
      );
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setBusyId(null);
    }
  };

  const removeProduct = async (product: ProductDto) => {
    if (busyId) return;
    if (!window.confirm(t.admin.deleteProductConfirm(product.name))) return;
    setBusyId(product.id);
    try {
      await apiFetch<unknown>(`/admin/products/${product.id}`, { method: 'DELETE', token });
      setProducts((current) =>
        current ? current.filter((item) => item.id !== product.id) : current,
      );
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setBusyId(null);
    }
  };

  /** Lọc theo từ khóa + trạng thái rồi sắp xếp — tất cả ở phía trình duyệt. */
  const visible = useMemo(() => {
    if (products === null) return null;
    const needle = query.trim().toLowerCase();
    const filtered = products.filter((product) => {
      if (status === 'ACTIVE' && !product.active) return false;
      if (status === 'HIDDEN' && product.active) return false;
      if (needle === '') return true;
      return (
        product.name.toLowerCase().includes(needle) ||
        product.slug.toLowerCase().includes(needle) ||
        (product.category ?? '').toLowerCase().includes(needle)
      );
    });

    const sorted = [...filtered];
    if (sort === 'NAME') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'STOCK_ASC') {
      sorted.sort((a, b) => a.availableStock - b.availableStock);
    } else if (sort === 'SOLD_DESC') {
      sorted.sort((a, b) => b.sold - a.sold);
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return sorted;
  }, [products, query, status, sort]);

  const statusTabs: TabItem<StatusFilter>[] = products
    ? [
        { value: 'ALL', label: `${t.admin.filterAll} (${products.length})` },
        {
          value: 'ACTIVE',
          label: `${t.admin.visible} (${products.filter((p) => p.active).length})`,
        },
        {
          value: 'HIDDEN',
          label: `${t.admin.hidden} (${products.filter((p) => !p.active).length})`,
        },
      ]
    : [];

  /** Nhãn tồn kho: hết hàng / sắp hết / bình thường. */
  const stockBadge = (product: ProductDto) => {
    if (product.availableStock === 0) {
      return <Badge variant="solid">{t.product.outOfStock}</Badge>;
    }
    if (product.availableStock <= LOW_STOCK_THRESHOLD) {
      return (
        <Badge variant="outline">
          {t.admin.lowStockBadge(product.availableStock)}
        </Badge>
      );
    }
    return <Badge variant="muted">{t.product.inStockShort(product.availableStock)}</Badge>;
  };

  const actionButtons = (product: ProductDto) => (
    <>
      <Link
        href={`/admin/products/${product.id}`}
        title={t.common.edit}
        aria-label={`${t.common.edit} ${product.name}`}
        className={ICON_BUTTON_CLASSES}
      >
        <Pencil strokeWidth={1.75} className="h-4 w-4" />
      </Link>
      <button
        type="button"
        title={product.active ? t.admin.hideProduct : t.admin.showProduct}
        aria-label={
          product.active
            ? `${t.admin.hideProduct}: ${product.name}`
            : `${t.admin.showProduct}: ${product.name}`
        }
        disabled={busyId !== null}
        onClick={() => void toggleActive(product)}
        className={ICON_BUTTON_CLASSES}
      >
        {busyId === product.id ? (
          <Spinner className="h-4 w-4" />
        ) : product.active ? (
          <Eye strokeWidth={1.75} className="h-4 w-4" />
        ) : (
          <EyeOff strokeWidth={1.75} className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        title={t.common.delete}
        aria-label={`${t.common.delete} ${product.name}`}
        disabled={busyId !== null}
        onClick={() => void removeProduct(product)}
        className={cn(ICON_BUTTON_CLASSES, 'hover:bg-red-50 hover:text-red-600')}
      >
        <Trash2 strokeWidth={1.75} className="h-4 w-4" />
      </button>
    </>
  );

  return (
    <>
      <PageHeader
        title={t.admin.productsTitle}
        description={
          products
            ? t.admin.productsSubtitle(products.length)
            : t.admin.productsSubtitleFallback
        }
        actions={
          <Link href="/admin/products/new" className={buttonVariants({})}>
            <Plus strokeWidth={1.75} className="h-4 w-4" />
            {t.admin.addProduct}
          </Link>
        }
      />

      {error ? (
        <EmptyState
          icon={ServerCrash}
          title={t.admin.productsError}
          hint={error}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      ) : products === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={t.admin.productsEmptyTitle}
          hint={t.admin.productsEmptyHint}
          action={
            <Link href="/admin/products/new" className={buttonVariants({})}>
              <Plus strokeWidth={1.75} className="h-4 w-4" />
              {t.admin.addProduct}
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Thanh công cụ: tìm kiếm · lọc trạng thái · sắp xếp · kiểu xem */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-xs">
              <Search
                strokeWidth={1.75}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.admin.productsSearchPlaceholder}
                aria-label={t.admin.productsSearchPlaceholder}
                className="h-10 w-full rounded-lg border border-neutral-300 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-950"
              />
              {query !== '' && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t.common.cancel}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
                >
                  <X strokeWidth={1.75} className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Tabs items={statusTabs} value={status} onChange={setStatus} />

              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                aria-label={t.admin.sortLabel}
                className="h-10 cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-neutral-950"
              >
                <option value="NEWEST">{t.admin.sortNewest}</option>
                <option value="NAME">{t.admin.sortName}</option>
                <option value="STOCK_ASC">{t.admin.sortStockAsc}</option>
                <option value="SOLD_DESC">{t.admin.sortSoldDesc}</option>
              </select>

              <div
                role="group"
                aria-label={t.admin.viewLabel}
                className="flex items-center gap-0.5 rounded-lg border border-neutral-300 p-0.5"
              >
                {(
                  [
                    { mode: 'grid' as const, icon: LayoutGrid, label: t.admin.viewGrid },
                    { mode: 'table' as const, icon: List, label: t.admin.viewTable },
                  ]
                ).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={view === mode}
                    onClick={() => changeView(mode)}
                    className={cn(
                      'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors',
                      view === mode
                        ? 'bg-neutral-950 text-white'
                        : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950',
                    )}
                  >
                    <Icon strokeWidth={1.75} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {visible !== null && visible.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 py-12 text-center text-sm text-neutral-500">
              {t.admin.productsFilterEmpty}
            </p>
          ) : view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(visible ?? []).map((product) => (
                <Card
                  key={product.id}
                  className={cn(
                    'flex flex-col gap-3 p-4 transition-colors hover:border-neutral-400',
                    !product.active && 'bg-neutral-50',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <ProductVisual
                      image={product.image}
                      name={product.name}
                      className={cn(
                        'h-14 w-14 shrink-0 rounded-lg',
                        !product.active && 'opacity-50 grayscale',
                      )}
                      iconClassName="h-6 w-6"
                    />
                    <div className="min-w-0 flex-1">
                      {product.category && (
                        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                          {product.category}
                        </p>
                      )}
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="block truncate font-medium text-neutral-950 underline-offset-4 hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="truncate font-mono text-xs text-neutral-400">
                        /{product.slug}
                      </p>
                    </div>
                    {!product.active && <Badge variant="muted">{t.admin.hidden}</Badge>}
                  </div>

                  <div className="flex items-end justify-between gap-3 border-t border-neutral-100 pt-3">
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums text-neutral-950">
                        {formatProductPrice(product, t)}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {t.admin.variantCount(product.variants.length)} ·{' '}
                        {t.product.sold(product.sold)}
                      </p>
                    </div>
                    {stockBadge(product)}
                  </div>

                  <div className="flex items-center justify-end gap-1 border-t border-neutral-100 pt-2">
                    {actionButtons(product)}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500">
                    <th className="px-4 py-3 font-medium">{t.admin.colProduct}</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {t.admin.colPrice}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">
                      {t.admin.colStock}
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
                      {t.admin.colSold}
                    </th>
                    <th className="px-4 py-3 font-medium">{t.admin.colStatus}</th>
                    <th className="px-4 py-3 text-right font-medium">{t.admin.colActions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(visible ?? []).map((product) => (
                    <tr key={product.id} className="transition-colors hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductVisual
                            image={product.image}
                            name={product.name}
                            className={cn(
                              'h-10 w-10 shrink-0',
                              !product.active && 'opacity-50',
                            )}
                            iconClassName="h-5 w-5"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/admin/products/${product.id}`}
                              className="block truncate font-medium text-neutral-950 underline-offset-4 hover:underline"
                            >
                              {product.name}
                            </Link>
                            <p className="truncate font-mono text-xs text-neutral-400">
                              /{product.slug}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <span className="font-semibold tabular-nums">
                          {formatProductPrice(product, t)}
                        </span>
                        <span className="block text-xs tabular-nums text-neutral-400">
                          {t.admin.variantCount(product.variants.length)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{stockBadge(product)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-500">
                        {product.sold}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={product.active ? 'solid' : 'muted'}>
                          {product.active ? t.admin.visible : t.admin.hidden}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {actionButtons(product)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
