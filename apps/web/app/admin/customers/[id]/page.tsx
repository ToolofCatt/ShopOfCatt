'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, ReceiptText, SearchX, ServerCrash } from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  type AdminCustomerDto,
  type OrderSummaryDto,
  type Paginated,
} from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { customerLabel } from '@/components/admin/helpers';
import { Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { Pagination } from '@/components/admin/pagination';
import {
  CustomerActions,
  CustomerStatusBadge,
  RoleBadge,
} from '@/components/admin/customer-actions';

const ORDERS_PAGE_SIZE = 20;

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-right text-neutral-950">{value}</dd>
    </div>
  );
}

export default function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [customer, setCustomer] = useState<AdminCustomerDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ordersPage, setOrdersPage] = useState(1);
  const [orders, setOrders] = useState<Paginated<OrderSummaryDto> | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const loadCustomer = useCallback(async (): Promise<AdminCustomerDto> => {
    return apiFetch<AdminCustomerDto>(`/admin/customers/${id}`, { token });
  }, [id, token]);

  useEffect(() => {
    let active = true;
    loadCustomer()
      .then((data) => {
        if (active) setCustomer(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [loadCustomer, t]);

  // Đơn hàng của khách — dùng bộ lọc userId của trang đơn hàng quản trị.
  useEffect(() => {
    let active = true;
    setOrdersLoading(true);
    setOrdersError(null);

    const search = new URLSearchParams();
    search.set('userId', id);
    search.set('page', String(ordersPage));
    search.set('limit', String(ORDERS_PAGE_SIZE));

    apiFetch<Paginated<OrderSummaryDto>>(`/admin/orders?${search.toString()}`, { token })
      .then((result) => {
        if (active) setOrders(result);
      })
      .catch((err: unknown) => {
        if (active) setOrdersError(apiErrorMessage(err, t.common.connectionError));
      })
      .finally(() => {
        if (active) setOrdersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, ordersPage, token, t]);

  const refreshCustomer = async () => {
    try {
      setCustomer(await loadCustomer());
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(apiErrorMessage(err, t.common.connectionError));
    }
  };

  if (notFound) {
    return (
      <EmptyState
        icon={SearchX}
        title={t.admin.customerNotFoundTitle}
        hint={t.admin.customerNotFoundHint}
        action={
          <Link href="/admin/customers" className={buttonVariants({ variant: 'outline' })}>
            {t.admin.backToCustomers}
          </Link>
        }
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={ServerCrash}
        title={t.admin.customerLoadError}
        hint={error}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (customer === null) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-950"
      >
        <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
        {t.admin.navCustomers}
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-neutral-950">
          {formatUserCode(customer.code)}
        </h1>
        <RoleBadge role={customer.role} />
        <CustomerStatusBadge locked={customer.lockedAt !== null} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
        {/* Info card */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
            {t.admin.customerInfoTitle}
          </h2>
          <dl className="mt-3 divide-y divide-neutral-100 text-sm">
            <InfoRow
              label={t.admin.infoCustomerCode}
              value={
                <span className="font-mono text-[13px] tabular-nums">
                  {formatUserCode(customer.code)}
                </span>
              }
            />
            <InfoRow
              label={t.admin.infoEmail}
              value={<span className="break-all">{customerLabel(customer)}</span>}
            />
            <InfoRow
              label={t.admin.infoBalance}
              value={`${customer.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}
            />
            <InfoRow label={t.admin.infoRole} value={<RoleBadge role={customer.role} />} />
            <InfoRow label={t.admin.infoCreatedAt} value={formatDate(customer.createdAt)} />
            <InfoRow
              label={t.admin.infoStatus}
              value={<CustomerStatusBadge locked={customer.lockedAt !== null} />}
            />
            <InfoRow label={t.admin.colOrders} value={String(customer.ordersCount)} />
            <InfoRow
              label={t.admin.colTotalSpent}
              value={
                <span className="font-semibold tabular-nums">
                  {formatUsdt(customer.totalSpent)}
                </span>
              }
            />
          </dl>
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <CustomerActions customer={customer} onChanged={refreshCustomer} />
          </div>
        </Card>

        {/* Orders table */}
        <div className="min-w-0">
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-neutral-950">
            {t.admin.customerOrdersTitle}
          </h2>
          {ordersError ? (
            <EmptyState
              icon={ServerCrash}
              title={t.admin.ordersError}
              hint={ordersError}
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
          ) : orders.items.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title={t.admin.ordersEmptyTitle}
              hint={t.admin.customerOrdersEmpty}
            />
          ) : (
            <>
              <Card className="overflow-x-auto">
                <table
                  className={
                    ordersLoading
                      ? 'w-full min-w-[640px] text-sm opacity-60'
                      : 'w-full min-w-[640px] text-sm'
                  }
                >
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-neutral-500">
                      <th className="px-4 py-3 font-medium">{t.admin.colOrderCode}</th>
                      <th className="px-4 py-3 font-medium">{t.admin.colDate}</th>
                      <th className="px-4 py-3 font-medium">{t.orders.colProduct}</th>
                      <th className="px-4 py-3 text-right font-medium">{t.orders.colTotal}</th>
                      <th className="px-4 py-3 font-medium">{t.orders.colStatus}</th>
                      <th className="px-4 py-3" aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {orders.items.map((order) => (
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
                page={ordersPage}
                total={orders.total}
                limit={ORDERS_PAGE_SIZE}
                onPageChange={setOrdersPage}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
