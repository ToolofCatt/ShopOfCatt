'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, PackageOpen, ServerCrash } from 'lucide-react';
import type { OrderStatus, OrderSummaryDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { usePrices } from '@/lib/prices';
import { Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { Tabs } from '@/components/admin/tabs';

/** 'ALL' + 5 trạng thái đơn hàng — lọc phía client trên danh sách đã tải. */
type OrderFilter = 'ALL' | OrderStatus;

const ORDER_FILTERS: OrderFilter[] = [
  'ALL',
  'PENDING',
  'PAID',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
];

export default function OrdersPage() {
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const { t, formatDate } = useI18n();
  const { priceUsdt } = usePrices();

  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('ALL');

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent('/orders')}`);
      return;
    }
    let active = true;
    apiFetch<OrderSummaryDto[]>('/orders', { token })
      .then((data) => {
        if (active) setOrders(data);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [authLoading, token, router, t]);

  // Tabs lọc trạng thái — đếm và lọc phía client từ danh sách đã tải.
  const filtered =
    orders === null
      ? null
      : filter === 'ALL'
        ? orders
        : orders.filter((order) => order.status === filter);

  const filterItems =
    orders === null
      ? []
      : ORDER_FILTERS.map((value) => ({
          value,
          label: t.orders.filterTab(
            value === 'ALL' ? t.orders.filterAll : t.orderStatus[value],
            value === 'ALL'
              ? orders.length
              : orders.filter((order) => order.status === value).length,
          ),
        }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t.orders.title}</h1>

      <div className="mt-6">
        {error ? (
          <EmptyState
            icon={ServerCrash}
            title={t.common.serverDownTitle}
            hint={error}
            action={
              <Button variant="outline" onClick={() => window.location.reload()}>
                {t.common.retry}
              </Button>
            }
          />
        ) : orders === null ? (
          <div className="flex justify-center py-24">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title={t.orders.emptyTitle}
            hint={t.orders.emptyHint}
            action={
              <Link href="/" className={buttonVariants({})}>
                {t.orders.shopNow}
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            <Tabs items={filterItems} value={filter} onChange={setFilter} />
            {filtered !== null && filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-neutral-500">
                {t.orders.filterEmpty}
              </p>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-neutral-500">
                      <th className="px-4 py-3 font-medium">{t.orders.colCode}</th>
                      <th className="px-4 py-3 font-medium">{t.orders.colDate}</th>
                      <th className="px-4 py-3 font-medium">{t.orders.colProduct}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.orders.colTotal}</th>
                      <th className="px-4 py-3 font-medium">{t.orders.colStatus}</th>
                      <th className="px-4 py-3" aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {(filtered ?? []).map((order) => (
                      <tr
                        key={order.code}
                        onClick={() => router.push(`/orders/${order.code}`)}
                        className="cursor-pointer transition-colors hover:bg-neutral-50"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/orders/${order.code}`}
                            className="font-mono font-medium text-neutral-950"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {order.code}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                          {formatDate(order.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {order.firstProductName}
                          {order.itemsCount > 1 && (
                            <span className="text-neutral-400">
                              {t.orders.moreItems(order.itemsCount - 1)}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                          {priceUsdt(order.totalAmount).primary}
                        </td>
                        <td className="px-4 py-3">
                          <OrderStatusBadge status={order.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight
                            className="ml-auto h-4 w-4 text-neutral-400"
                            strokeWidth={1.75}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
