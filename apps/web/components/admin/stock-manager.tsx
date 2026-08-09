'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, PackagePlus, Trash2 } from 'lucide-react';
import type {
  AddStockResponse,
  Paginated,
  StockItemDto,
  StockStatus,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button, EmptyState, Spinner } from '@/components/ui';
import { TEXTAREA_CLASSES } from '@/components/admin/helpers';
import { Pagination } from '@/components/admin/pagination';
import { Tabs, type TabItem } from '@/components/admin/tabs';

const PAGE_SIZE = 50;
const STOCK_TAB_VALUES: StockStatus[] = ['AVAILABLE', 'RESERVED', 'SOLD'];

export interface StockManagerProps {
  /** Kho thuộc về một loại sản phẩm, không phải sản phẩm. */
  variantId: string;
  /** Called after a successful add/delete so the parent can refresh stock counters. */
  onStockChanged?: () => void;
}

/** Ô nhập dòng kho + bảng dòng kho của MỘT loại sản phẩm. */
export function StockManager({ variantId, onStockChanged }: StockManagerProps) {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const stockTabs: TabItem<StockStatus>[] = STOCK_TAB_VALUES.map((status) => ({
    value: status,
    label: t.stockStatus[status],
  }));

  // --- Add lines form ---
  const [content, setContent] = useState('');
  const [dedupe, setDedupe] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addResult, setAddResult] = useState<AddStockResponse | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const lineCount = useMemo(
    () => content.split('\n').filter((line) => line.trim().length > 0).length,
    [content],
  );

  // --- Line table ---
  const [tab, setTab] = useState<StockStatus>('AVAILABLE');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<StockItemDto> | null>(null);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refreshTable = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setTableLoading(true);
    setTableError(null);
    apiFetch<Paginated<StockItemDto>>(
      `/admin/variants/${variantId}/stock?status=${tab}&page=${page}&limit=${PAGE_SIZE}`,
      { token },
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) setTableError(apiErrorMessage(err, t.common.connectionError));
      })
      .finally(() => {
        if (active) setTableLoading(false);
      });
    return () => {
      active = false;
    };
  }, [variantId, tab, page, token, reloadKey, t]);

  const handleTabChange = (next: StockStatus) => {
    setTab(next);
    setPage(1);
  };

  const handleAdd = async () => {
    if (adding || lineCount === 0) return;
    setAdding(true);
    setAddError(null);
    setAddResult(null);
    try {
      const result = await apiFetch<AddStockResponse>(`/admin/variants/${variantId}/stock`, {
        method: 'POST',
        body: { content, dedupe },
        token,
      });
      setAddResult(result);
      setContent('');
      setPage(1);
      refreshTable();
      onStockChanged?.();
    } catch (err) {
      setAddError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (item: StockItemDto) => {
    if (deletingId) return;
    if (!window.confirm(t.admin.stockDeleteConfirm)) return;
    setDeletingId(item.id);
    try {
      await apiFetch<unknown>(`/admin/stock/${item.id}`, { method: 'DELETE', token });
      // If the last line on the page was removed, step back one page.
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      refreshTable();
      onStockChanged?.();
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setDeletingId(null);
    }
  };

  const showOrderColumn = tab !== 'AVAILABLE';
  const showDeleteColumn = tab === 'AVAILABLE';

  return (
    <div>
      {/* Add lines */}
      <div className="space-y-3">
        <textarea
          rows={6}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setAddResult(null);
            setAddError(null);
          }}
          placeholder={'KEY-AAAA-BBBB\nKEY-CCCC-DDDD\n...'}
          className={cn(TEXTAREA_CLASSES, 'font-mono')}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={dedupe}
              onChange={(event) => setDedupe(event.target.checked)}
              className="h-4 w-4 cursor-pointer accent-neutral-950"
            />
            {t.admin.stockDedupe}
          </label>
          <span className="text-xs tabular-nums text-neutral-500">
            {t.admin.stockLineCount(lineCount)}
          </span>
          <Button
            className="ml-auto"
            loading={adding}
            disabled={lineCount === 0}
            onClick={() => void handleAdd()}
          >
            {!adding && <PackagePlus strokeWidth={1.75} className="h-4 w-4" />}
            {t.admin.stockAdd}
          </Button>
        </div>
        {addResult && (
          <p className="text-sm font-medium text-emerald-600">
            {t.admin.stockAddResult(addResult.added, addResult.skipped, addResult.total)}
          </p>
        )}
        {addError && <p className="text-sm text-red-600">{addError}</p>}
      </div>

      {/* Line table */}
      <div className="mt-6 border-t border-neutral-100 pt-5">
        <Tabs items={stockTabs} value={tab} onChange={handleTabChange} />

        <div className="mt-4">
          {tableError ? (
            <EmptyState icon={Inbox} title={t.admin.stockTableError} hint={tableError} />
          ) : tableLoading && data === null ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-5 w-5 text-neutral-400" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t.admin.stockEmptyTitle(t.stockStatus[tab])}
              hint={
                tab === 'AVAILABLE'
                  ? t.admin.stockEmptyHintAvailable
                  : t.admin.stockEmptyHintOther
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
                      <th className="px-4 py-2.5 font-medium">{t.admin.stockColContent}</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">
                        {t.admin.stockColDate}
                      </th>
                      {showOrderColumn && (
                        <th className="whitespace-nowrap px-4 py-2.5 font-medium">
                          {t.admin.stockColOrder}
                        </th>
                      )}
                      {showDeleteColumn && <th className="px-4 py-2.5" aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody className={tableLoading ? 'divide-y divide-neutral-100 opacity-60' : 'divide-y divide-neutral-100'}>
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td className="max-w-[280px] truncate px-4 py-2.5 font-mono text-[13px] text-neutral-950">
                          {item.content}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-neutral-500">
                          {formatDate(item.createdAt)}
                        </td>
                        {showOrderColumn && (
                          <td className="whitespace-nowrap px-4 py-2.5">
                            {item.orderCode ? (
                              <Link
                                href={`/admin/orders/${item.orderCode}`}
                                className="font-mono font-medium text-neutral-950 underline underline-offset-4 hover:no-underline"
                              >
                                {item.orderCode}
                              </Link>
                            ) : (
                              <span className="text-neutral-400">—</span>
                            )}
                          </td>
                        )}
                        {showDeleteColumn && (
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              title={t.admin.stockDeleteLine}
                              aria-label={`${t.admin.stockDeleteLine}: ${item.content}`}
                              disabled={deletingId !== null}
                              onClick={() => void handleDelete(item)}
                              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-50"
                            >
                              {deletingId === item.id ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : (
                                <Trash2 strokeWidth={1.75} className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                className="mt-4"
                page={page}
                total={data.total}
                limit={PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
