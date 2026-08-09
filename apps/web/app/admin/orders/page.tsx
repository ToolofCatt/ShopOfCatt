'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, ReceiptText, Search, ServerCrash } from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  type OrderStatus,
  type OrderSummaryDto,
  type Paginated,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, EmptyState, Input, Spinner } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { Tabs, type TabItem } from '@/components/admin/tabs';

const PAGE_SIZE = 20;

type StatusFilter = OrderStatus | 'ALL';

const ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'PAID',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
];

export default function AdminOrdersPage() {
  const router = useRouter();
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const statusTabs: TabItem<StatusFilter>[] = [
    { value: 'ALL', label: t.admin.ordersAll },
    ...ORDER_STATUSES.map((status) => ({
      value: status as StatusFilter,
      label: t.orderStatus[status],
    })),
  ];

  const [tab, setTab] = useState<StatusFilter>('ALL');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<Paginated<OrderSummaryDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box → one request per pause, page reset on change.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const search = new URLSearchParams();
    if (tab !== 'ALL') search.set('status', tab);
    if (debouncedQuery) search.set('q', debouncedQuery);
    search.set('page', String(page));
    search.set('limit', String(PAGE_SIZE));

    apiFetch<Paginated<OrderSummaryDto>>(`/admin/orders?${search.toString()}`, { token })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, debouncedQuery, page, token, t]);

  const handleTabChange = (next: StatusFilter) => {
    setTab(next);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t.admin.ordersTitle} description={t.admin.ordersSubtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs items={statusTabs} value={tab} onChange={handleTabChange} />
        <div className="relative ml-auto w-full sm:w-72">
          <Search
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.admin.ordersSearchPlaceholder}
            className="pl-9"
            aria-label={t.admin.ordersSearchAria}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={ServerCrash}
          title={t.admin.ordersError}
          hint={error}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      ) : data === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t.admin.ordersEmptyTitle}
          hint={
            debouncedQuery
              ? t.admin.ordersEmptyHintSearch(debouncedQuery)
              : t.admin.ordersEmptyHint
          }
        />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className={loading ? 'w-full min-w-[760px] text-sm opacity-60' : 'w-full min-w-[760px] text-sm'}>
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-4 py-3 font-medium">{t.admin.colOrderCode}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colCustomer}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colDate}</th>
                  <th className="px-4 py-3 font-medium">{t.orders.colProduct}</th>
                  <th className="px-4 py-3 text-right font-medium">{t.orders.colTotal}</th>
                  <th className="px-4 py-3 font-medium">{t.orders.colStatus}</th>
                  <th className="px-4 py-3" aria-hidden="true" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.items.map((order) => (
                  <tr
                    key={order.code}
                    onClick={() => router.push(`/admin/orders/${order.code}`)}
                    className="cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.code}`}
                        className="font-mono font-medium text-neutral-950"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {order.code}
                      </Link>
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <span className="block truncate text-neutral-700">
                        {order.userEmail ?? '—'}
                      </span>
                      {order.userCode !== undefined && (
                        <span className="block font-mono text-xs tabular-nums text-neutral-400">
                          {formatUserCode(order.userCode)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-3">
                      {order.firstProductName}
                      {order.itemsCount > 1 && (
                        <span className="text-neutral-400">
                          {t.orders.moreItems(order.itemsCount - 1)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                      {formatUsdt(order.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight
                        strokeWidth={1.75}
                        className="ml-auto h-4 w-4 text-neutral-400"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination
            className="mt-4"
            page={page}
            total={data.total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
