'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Package,
  PackageX,
  Plus,
  ReceiptText,
  ServerCrash,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  LOW_STOCK_THRESHOLD,
  type AdminStatsDto,
  type OrderSummaryDto,
  type Paginated,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { PageHeader } from '@/components/admin/page-header';
import { StatCard } from '@/components/admin/stat-card';
import { RevenueChart } from '@/components/admin/revenue-chart';
import { ReadinessBanner } from '@/components/admin/readiness-banner';
import { InsightsPanels } from '@/components/admin/insights';
import { formatAmount } from '@/components/admin/helpers';

/** Số đơn gần đây hiển thị trên trang tổng quan. */
const RECENT_ORDERS = 6;
/** Số cảnh báo kho tối đa trong hộp "Cần xử lý". */
const MAX_STOCK_ALERTS = 4;

/** Tiêu đề thẻ: tên + mô tả ngắn + biểu tượng mờ bên phải. */
function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon: typeof Package;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {action ?? (
        <Icon strokeWidth={1.75} className="h-5 w-5 shrink-0 text-neutral-400" />
      )}
    </div>
  );
}

/** Một dòng việc cần xử lý: dẫn thẳng tới chỗ giải quyết nó. */
function AlertRow({
  label,
  sub,
  value,
  urgent,
  href,
}: {
  label: string;
  sub?: string;
  value: string;
  urgent: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-800">{label}</span>
        {sub && <span className="block truncate text-xs text-neutral-500">{sub}</span>}
      </span>
      <Badge variant={urgent ? 'solid' : 'muted'}>{value}</Badge>
      <ChevronRight
        strokeWidth={1.75}
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500"
      />
    </Link>
  );
}

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [stats, setStats] = useState<AdminStatsDto | null>(null);
  const [recent, setRecent] = useState<OrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<AdminStatsDto>('/admin/stats', { token })
      .then((data) => {
        if (active) setStats(data);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    // Đơn gần đây tải riêng — lỗi ở đây không làm hỏng cả trang.
    apiFetch<Paginated<OrderSummaryDto>>(`/admin/orders?limit=${RECENT_ORDERS}`, { token })
      .then((data) => {
        if (active) setRecent(data.items);
      })
      .catch(() => {
        if (active) setRecent([]);
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  if (error) {
    return (
      <>
        <PageHeader title={t.admin.dashboardTitle} />
        <EmptyState
          icon={ServerCrash}
          title={t.admin.statsError}
          hint={error}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      </>
    );
  }

  if (stats === null) {
    return (
      <>
        <PageHeader title={t.admin.dashboardTitle} />
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      </>
    );
  }

  const topRevenueMax = Math.max(1, ...stats.topProducts.map((p) => p.revenue));
  const stockAlerts = stats.lowStock.slice(0, MAX_STOCK_ALERTS);
  const alertCount = stats.ordersPending + stats.lowStock.length;

  return (
    <>
      <PageHeader
        title={t.admin.dashboardTitle}
        description={t.admin.dashboardSubtitle}
        actions={
          <>
            <Link
              href="/admin/orders"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ReceiptText strokeWidth={1.75} className="h-4 w-4" />
              {t.admin.viewOrders}
            </Link>
            <Link href="/admin/products/new" className={buttonVariants({ size: 'sm' })}>
              <Plus strokeWidth={1.75} className="h-4 w-4" />
              {t.admin.addProduct}
            </Link>
          </>
        }
      />

      <ReadinessBanner
        readiness={stats.readiness}
        productsActive={stats.productsActive}
      />

      {/* Bốn chỉ số nền tảng. "Tổng doanh thu" = mọi thời gian, khác với
          con số theo kỳ trong biểu đồ bên dưới nên nhãn phải nói rõ. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          accent
          icon={Wallet}
          label={t.admin.statRevenueAllTime}
          value={formatAmount(stats.revenue)}
          hint={t.admin.statRevenueHint}
        />
        <StatCard
          icon={ReceiptText}
          label={t.admin.statOrders}
          value={String(stats.ordersTotal)}
          hint={t.admin.statOrdersToday(stats.ordersToday)}
        />
        <StatCard
          icon={Users}
          label={t.admin.statCustomers}
          value={String(stats.customersTotal)}
          hint={t.admin.statCustomersNew(stats.customersNew30d)}
        />
        <StatCard
          icon={Package}
          label={t.admin.storeActiveProducts}
          value={String(stats.productsActive)}
        />
      </div>

      {/* Biểu đồ (2/3) + việc cần xử lý (1/3). Cảnh báo kho nằm HẲN ở đây,
          không lặp lại thành thẻ riêng ở dưới. */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>

        <Card className="p-6">
          <PanelHeader
            title={t.admin.attentionTitle}
            subtitle={t.admin.attentionSubtitle}
            icon={PackageX}
            action={alertCount > 0 ? <Badge variant="solid">{alertCount}</Badge> : undefined}
          />

          {alertCount === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center">
              <CheckCircle2 strokeWidth={1.75} className="h-6 w-6 text-neutral-400" />
              <p className="text-sm text-neutral-500">{t.admin.attentionAllClear}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {stats.ordersPending > 0 && (
                <AlertRow
                  label={t.admin.attentionPending}
                  value={String(stats.ordersPending)}
                  urgent
                  href="/admin/orders"
                />
              )}
              {stockAlerts.map((item) => (
                <AlertRow
                  key={item.variantId}
                  label={item.name}
                  sub={item.variantName || undefined}
                  value={
                    item.availableStock === 0
                      ? t.product.outOfStock
                      : t.product.inStockShort(item.availableStock)
                  }
                  urgent={item.availableStock === 0}
                  href={`/admin/products/${item.productId}`}
                />
              ))}
              {stats.lowStock.length > MAX_STOCK_ALERTS && (
                <Link
                  href="/admin/products"
                  className="flex items-center justify-center gap-1 py-1 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-950 hover:underline"
                >
                  {t.admin.attentionMore(stats.lowStock.length - MAX_STOCK_ALERTS)}
                  <ArrowRight strokeWidth={1.75} className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        {/* Đơn hàng gần đây — "chuyện gì vừa xảy ra", thứ thiếu nhất trước đây. */}
        <Card className="p-6">
          <PanelHeader
            title={t.admin.recentOrdersTitle}
            subtitle={t.admin.recentOrdersSubtitle}
            icon={ReceiptText}
            action={
              <Link
                href="/admin/orders"
                className="flex shrink-0 items-center gap-1 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-950 hover:underline"
              >
                {t.admin.recentOrdersAll}
                <ArrowRight strokeWidth={1.75} className="h-3.5 w-3.5" />
              </Link>
            }
          />

          <div className="mt-4">
            {recent === null ? (
              <div className="flex justify-center py-10">
                <Spinner className="h-5 w-5 text-neutral-400" />
              </div>
            ) : recent.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
                {t.admin.recentOrdersEmpty}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {recent.map((order) => (
                  <li key={order.code}>
                    <Link
                      href={`/admin/orders/${order.code}`}
                      className="group flex items-center gap-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-neutral-950 underline-offset-4 group-hover:underline">
                            {order.code}
                          </span>
                          <OrderStatusBadge status={order.status} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">
                          {order.userCode !== undefined
                            ? `${formatUserCode(order.userCode)} · `
                            : ''}
                          {formatDate(order.createdAt)}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-950">
                        {formatUsdt(order.totalAmount)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Top sản phẩm — thanh tỉ lệ để so sánh bằng mắt. */}
        <Card className="p-6">
          <PanelHeader
            title={t.admin.topProductsTitle}
            subtitle={t.admin.topProductsSubtitle}
            icon={TrendingUp}
          />

          <div className="mt-4">
            {stats.topProducts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
                {t.admin.topProductsEmpty}
              </p>
            ) : (
              <ol className="space-y-3">
                {stats.topProducts.map((product, index) => (
                  <li key={product.productId}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-neutral-400">
                          {index + 1}
                        </span>
                        <Link
                          href={`/admin/products/${product.productId}`}
                          className="min-w-0 truncate text-sm font-medium text-neutral-950 underline-offset-4 hover:underline"
                        >
                          {product.name}
                        </Link>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-950">
                        {formatUsdt(product.revenue)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-6">
                      <span
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100"
                        aria-hidden="true"
                      >
                        <span
                          className={cn('block h-full rounded-full bg-neutral-950')}
                          style={{
                            width: `${Math.max(2, (product.revenue / topRevenueMax) * 100)}%`,
                          }}
                        />
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                        {t.product.sold(product.sold)}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-neutral-400">
        {t.admin.lowStockHint(LOW_STOCK_THRESHOLD)}
      </p>

      <InsightsPanels />
    </>
  );
}
