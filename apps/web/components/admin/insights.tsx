'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Eye, SearchX } from 'lucide-react';
import type { StoreInsightsDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Card } from '@/components/ui';

/** Số ngày gộp lại — khớp với INSIGHT_DAYS ở phía API. */
const DAYS = 30;

/**
 * Khách xem gì và tìm gì.
 *
 * Tỉ lệ chuyển đổi mới là con số hành động được: xem nhiều mà mua ít thường là
 * giá sai hoặc mô tả chưa thuyết phục. Còn danh sách "tìm mà không có" nói thẳng
 * cho chủ shop biết nên nhập hàng gì tiếp.
 */
export function InsightsPanels() {
  const { token } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<StoreInsightsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    apiFetch<StoreInsightsDto>(`/admin/stats/insights?days=${DAYS}`, { token })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token, t.common.connectionError]);

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card className="p-6">
        <Header
          title={t.admin.insightsTitle}
          subtitle={t.admin.insightsSubtitle(DAYS)}
          icon={Eye}
        />
        <div className="mt-4">
          {!data || data.products.length === 0 ? (
            <Empty text={t.admin.insightsEmpty} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="pb-2 font-medium">{t.admin.insightsColProduct}</th>
                  <th className="pb-2 text-right font-medium">{t.admin.insightsColViews}</th>
                  <th className="pb-2 text-right font-medium">{t.admin.insightsColSold}</th>
                  <th className="pb-2 text-right font-medium">
                    {t.admin.insightsColConversion}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.products.map((row) => (
                  <tr key={row.productId}>
                    <td className="max-w-0 py-2 pr-2">
                      <Link
                        href={`/admin/products/${row.productId}`}
                        className="block truncate font-medium text-neutral-950 underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-600">
                      {row.views}
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-600">
                      {row.sold}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-neutral-950">
                      {row.conversion === null
                        ? t.common.dash
                        : `${(row.conversion * 100).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <Header
          title={t.admin.searchesTitle}
          subtitle={t.admin.searchesSubtitle(DAYS)}
          icon={SearchX}
        />
        <div className="mt-4 space-y-5">
          <section>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t.admin.searchesZeroTitle}
            </p>
            {!data || data.zeroResultSearches.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">{t.admin.searchesZeroEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.zeroResultSearches.map((row) => (
                  <li
                    key={row.term}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium text-neutral-950">
                      {row.term}
                    </span>
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {t.admin.searchesTimes(row.zeroResults)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t.admin.searchesTopTitle}
            </p>
            {!data || data.topSearches.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-500">{t.admin.searchesEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {data.topSearches.map((row) => (
                  <li
                    key={row.term}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-neutral-700">{row.term}</span>
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {t.admin.searchesTimes(row.count)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}

function Header({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon: typeof Eye;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-950">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
      </div>
      <Icon className="h-5 w-5 shrink-0 text-neutral-300" strokeWidth={1.75} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
      {text}
    </p>
  );
}
