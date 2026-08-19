'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Inbox, PackageMinus, PackagePlus, RotateCcw, Trash2 } from 'lucide-react';
import {
  STOCK_DRAW_MODES,
  type AddStockResponse,
  type Paginated,
  type StockDrawMode,
  type StockItemDto,
  type StockStatus,
  type WithdrawStockResponse,
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
const STOCK_TAB_VALUES: StockStatus[] = ['AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN'];

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

  // --- Rút kho ---
  const [withdrawQty, setWithdrawQty] = useState('1');
  const [withdrawMode, setWithdrawMode] = useState<StockDrawMode>('SEQUENTIAL');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<WithdrawStockResponse | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // --- Line table ---
  const [tab, setTab] = useState<StockStatus>('AVAILABLE');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<StockItemDto> | null>(null);
  const [tableLoading, setTableLoading] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
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

  const handleWithdraw = async () => {
    const quantity = Number(withdrawQty);
    if (withdrawing || !Number.isInteger(quantity) || quantity < 1) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawResult(null);
    setCopied(false);
    try {
      const result = await apiFetch<WithdrawStockResponse>(
        `/admin/variants/${variantId}/withdraw`,
        { method: 'POST', body: { quantity, mode: withdrawMode }, token },
      );
      setWithdrawResult(result);
      setPage(1);
      refreshTable();
      onStockChanged?.();
    } catch (err) {
      setWithdrawError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setWithdrawing(false);
    }
  };

  const handleCopyWithdrawn = async () => {
    if (!withdrawResult) return;
    const text = withdrawResult.lines.map((line) => line.content).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleRestore = async (item: StockItemDto) => {
    if (restoringId) return;
    setRestoringId(item.id);
    try {
      await apiFetch<StockItemDto>(`/admin/stock/${item.id}/restore`, {
        method: 'POST',
        token,
      });
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      refreshTable();
      onStockChanged?.();
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setRestoringId(null);
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

  // Cột "đơn hàng" chỉ có nghĩa với dòng đã bán / đang giữ cho một đơn.
  const showOrderColumn = tab === 'RESERVED' || tab === 'SOLD';
  const showDeleteColumn = tab === 'AVAILABLE';
  const showRestoreColumn = tab === 'WITHDRAWN';

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

      {/*
        Rút kho: lấy key ra khỏi kho để tự thu hồi. Đi qua đúng truy vấn có khoá
        mà luồng đặt đơn dùng, nên không bao giờ rút được dòng mà một đơn đang giữ.
      */}
      <div className="mt-6 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div>
          <p className="text-sm font-medium text-neutral-950">{t.admin.stockWithdrawTitle}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{t.admin.stockWithdrawHint}</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-700">
              {t.admin.stockWithdrawQuantity}
            </span>
            <input
              id="stock-withdraw-quantity"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={withdrawQty}
              onChange={(event) => {
                setWithdrawQty(event.target.value);
                setWithdrawError(null);
              }}
              className="h-10 w-24 rounded-lg border border-neutral-300 bg-white px-3 text-sm tabular-nums text-neutral-950 focus:border-neutral-950 focus:outline-none focus:ring-2 focus:ring-neutral-950/10"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-700">
              {t.admin.stockWithdrawMode}
            </span>
            <Tabs
              items={STOCK_DRAW_MODES.map((mode) => ({
                value: mode,
                label: t.admin.formStockDrawModes[mode],
              }))}
              value={withdrawMode}
              onChange={setWithdrawMode}
            />
          </div>

          <Button
            variant="outline"
            className="ml-auto"
            loading={withdrawing}
            onClick={() => void handleWithdraw()}
          >
            {!withdrawing && <PackageMinus strokeWidth={1.75} className="h-4 w-4" />}
            {t.admin.stockWithdrawAction}
          </Button>
        </div>

        {withdrawError && <p className="text-sm text-red-600">{withdrawError}</p>}

        {withdrawResult && (
          <div className="space-y-2 border-t border-neutral-200 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-950">
                {t.admin.stockWithdrawResult(
                  withdrawResult.withdrawn,
                  withdrawResult.remaining,
                )}
              </p>
              <Button size="sm" variant="outline" onClick={() => void handleCopyWithdrawn()}>
                <Copy strokeWidth={1.75} className="h-3.5 w-3.5" />
                {copied ? t.common.copied : t.admin.stockWithdrawCopy}
              </Button>
            </div>
            {/*
              readOnly chứ không disabled: chủ shop vẫn cần bôi đen chọn tay được
              khi trình duyệt chặn clipboard.
            */}
            <textarea
              readOnly
              rows={Math.min(10, Math.max(3, withdrawResult.lines.length))}
              value={withdrawResult.lines.map((line) => line.content).join('\n')}
              className={cn(TEXTAREA_CLASSES, 'font-mono bg-white')}
            />
            <p className="text-xs text-neutral-500">{t.admin.stockWithdrawKeepSafe}</p>
          </div>
        )}
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
                      {(showDeleteColumn || showRestoreColumn) && (
                        <th className="px-4 py-2.5" aria-hidden="true" />
                      )}
                    </tr>
                  </thead>
                  <tbody className={tableLoading ? 'divide-y divide-neutral-100 opacity-60' : 'divide-y divide-neutral-100'}>
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td className="max-w-[280px] truncate px-4 py-2.5 font-mono text-[13px] text-neutral-950">
                          {item.content}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-neutral-500">
                          {formatDate(item.withdrawnAt ?? item.createdAt)}
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
                        {showRestoreColumn && (
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              title={t.admin.stockRestoreLine}
                              aria-label={`${t.admin.stockRestoreLine}: ${item.content}`}
                              disabled={restoringId !== null}
                              onClick={() => void handleRestore(item)}
                              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:pointer-events-none disabled:opacity-50"
                            >
                              {restoringId === item.id ? (
                                <Spinner className="h-3.5 w-3.5" />
                              ) : (
                                <RotateCcw strokeWidth={1.75} className="h-3.5 w-3.5" />
                              )}
                              {t.admin.stockRestoreLine}
                            </button>
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
