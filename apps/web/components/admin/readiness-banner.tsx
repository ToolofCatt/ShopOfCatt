'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ShieldAlert } from 'lucide-react';
import type { StoreReadinessDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

type Severity = 'blocking' | 'warning';

interface Issue {
  key: string;
  severity: Severity;
  title: string;
  hint: string;
  href: string;
  action: string;
}

/**
 * Cảnh báo những thứ khiến cửa hàng KHÔNG bán được — đặt ngay đầu trang tổng
 * quan vì đây là loại lỗi im lặng: giao diện trông vẫn bình thường, chỉ khách
 * mới thấy lỗi lúc bấm đặt hàng, và họ thường bỏ đi thay vì báo lại.
 */
export function ReadinessBanner({
  readiness,
  productsActive,
}: {
  readiness: StoreReadinessDto;
  productsActive: number;
}) {
  const { t } = useI18n();
  const r = t.admin.readiness;
  const issues: Issue[] = [];

  if (readiness.activePaymentMethods.length === 0) {
    issues.push({
      key: 'no-payment',
      severity: 'blocking',
      title: r.noPaymentTitle,
      hint: r.noPaymentHint,
      href: '/admin/settings',
      action: r.goSettings,
    });
  }
  if (productsActive === 0) {
    issues.push({
      key: 'no-product',
      severity: 'blocking',
      title: r.noProductTitle,
      hint: r.noProductHint,
      href: '/admin/products/new',
      action: r.goAddProduct,
    });
  } else if (readiness.stockAvailable === 0) {
    issues.push({
      key: 'no-stock',
      severity: 'blocking',
      title: r.noStockTitle,
      hint: r.noStockHint,
      href: '/admin/products',
      action: r.goProducts,
    });
  }
  if (readiness.mockActive) {
    issues.push({
      key: 'mock',
      severity: 'blocking',
      title: r.mockTitle,
      hint: r.mockHint,
      href: '/admin/settings',
      action: r.goSettings,
    });
  }
  if (readiness.binancePayKeyMissing) {
    issues.push({
      key: 'binance-key',
      severity: 'warning',
      title: r.binanceKeyTitle,
      hint: r.binanceKeyHint,
      href: '/admin/settings',
      action: r.goSettings,
    });
  }

  if (issues.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {issues.map((issue) => {
        const blocking = issue.severity === 'blocking';
        const Icon = blocking ? ShieldAlert : AlertTriangle;
        return (
          <div
            key={issue.key}
            role="alert"
            className={cn(
              'flex flex-wrap items-start gap-3 rounded-xl border p-4',
              blocking
                ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50',
            )}
          >
            <Icon
              strokeWidth={1.75}
              className={cn(
                'mt-0.5 h-5 w-5 shrink-0',
                blocking ? 'text-red-600' : 'text-amber-600',
              )}
            />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-sm font-semibold',
                  blocking ? 'text-red-900' : 'text-amber-900',
                )}
              >
                {issue.title}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-sm',
                  blocking ? 'text-red-700' : 'text-amber-700',
                )}
              >
                {issue.hint}
              </p>
            </div>
            <Link
              href={issue.href}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                blocking
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-amber-600 text-white hover:bg-amber-700',
              )}
            >
              {issue.action}
              <ArrowRight strokeWidth={1.75} className="h-3.5 w-3.5" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
