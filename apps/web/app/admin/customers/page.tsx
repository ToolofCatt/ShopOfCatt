'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Search, ServerCrash, Users } from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  type AdminCustomerDto,
  type Paginated,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, EmptyState, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import {
  CustomerActions,
  CustomerStatusBadge,
  RoleBadge,
} from '@/components/admin/customer-actions';

const PAGE_SIZE = 20;

export default function AdminCustomersPage() {
  const router = useRouter();
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<Paginated<AdminCustomerDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce ô tìm kiếm — 400ms, đổi từ khóa thì quay về trang 1.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (): Promise<Paginated<AdminCustomerDto>> => {
    const search = new URLSearchParams();
    if (debouncedQuery) search.set('q', debouncedQuery);
    search.set('page', String(page));
    search.set('limit', String(PAGE_SIZE));
    return apiFetch<Paginated<AdminCustomerDto>>(`/admin/customers?${search.toString()}`, {
      token,
    });
  }, [debouncedQuery, page, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
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
  }, [load, t]);

  const refresh = async () => {
    try {
      setData(await load());
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
    }
  };

  return (
    <>
      <PageHeader title={t.admin.customersTitle} description={t.admin.customersSubtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative ml-auto w-full sm:w-72">
          <Search
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.admin.customersSearchPlaceholder}
            className="pl-9"
            aria-label={t.admin.customersSearchAria}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          icon={ServerCrash}
          title={t.admin.customersError}
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
          icon={Users}
          title={t.admin.customersEmptyTitle}
          hint={
            debouncedQuery
              ? t.admin.customersEmptyHintSearch(debouncedQuery)
              : t.admin.customersEmptyHint
          }
        />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table
              className={
                loading ? 'w-full min-w-[900px] text-sm opacity-60' : 'w-full min-w-[900px] text-sm'
              }
            >
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-4 py-3 font-medium">{t.admin.colCustomerCode}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colEmail}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colRole}</th>
                  <th className="px-4 py-3 text-right font-medium">{t.admin.colOrders}</th>
                  <th className="px-4 py-3 text-right font-medium">{t.admin.colTotalSpent}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colCreatedAt}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colStatus}</th>
                  <th className="px-4 py-3 text-right font-medium">{t.admin.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.items.map((customer) => (
                  <tr
                    key={customer.id}
                    onClick={() => router.push(`/admin/customers/${customer.id}`)}
                    className="cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${customer.id}`}
                        className="font-mono font-medium tabular-nums text-neutral-950"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {formatUserCode(customer.code)}
                      </Link>
                    </td>
                    <td className="max-w-[240px] px-4 py-3">
                      <span className="block truncate text-neutral-950">{customer.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={customer.role} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-neutral-700">
                      {customer.ordersCount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">
                      {formatUsdt(customer.totalSpent)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                      {formatDate(customer.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <CustomerStatusBadge locked={customer.lockedAt !== null} />
                    </td>
                    <td className="px-4 py-3">
                      <CustomerActions
                        customer={customer}
                        onChanged={refresh}
                        className="flex flex-wrap items-center justify-end gap-2"
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
