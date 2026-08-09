'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileDown,
  PackageSearch,
  RotateCcw,
  ServerCrash,
} from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  type OrderDetailDto,
  type PublicUser,
} from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { wordmarkText } from '@/components/wordmark';

/* ---------- clipboard / download helpers ---------- */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}

function downloadTxt(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/* ---------- biên nhận .txt (nội dung theo ngôn ngữ đang chọn) ---------- */

function buildReceipt(
  order: OrderDetailDto,
  user: PublicUser | null,
  t: Dictionary,
  formatDate: (value: string | null | undefined) => string,
): string {
  const lines: string[] = [];
  lines.push(wordmarkText());
  lines.push('================================');
  lines.push(
    `${t.orderDetail.receiptOrderCode}: ${order.code}      ${t.orderDetail.receiptStatus}: ${t.orderStatus[order.status]}`,
  );
  if (user) {
    lines.push(`${t.orderDetail.receiptCustomer}: ${user.email} (${formatUserCode(user.code)})`);
  }
  lines.push(
    `${t.orderDetail.receiptCreatedAt}: ${formatDate(order.createdAt)}   ${t.orderDetail.receiptPaidAt}: ${formatDate(order.paidAt)}`,
  );
  lines.push('');
  order.items.forEach((item, index) => {
    const name = item.variantName
      ? `${item.productName} — ${item.variantName}`
      : item.productName;
    lines.push(
      `${index + 1}. ${name} | ${t.orderDetail.receiptQty} ${item.quantity} × ${item.unitPrice.toFixed(2)} = ${formatUsdt(item.unitPrice * item.quantity)}`,
    );
    for (const delivered of item.deliveredLines ?? []) {
      lines.push(`   ${delivered}`);
    }
  });
  lines.push('--------------------------------');
  if (order.discountAmount > 0) {
    lines.push(
      `${t.orderDetail.subtotal}: ${formatUsdt(order.subtotalAmount)}`,
    );
    lines.push(
      `${t.orderDetail.discount}${
        order.couponCode ? ` (${order.couponCode})` : ''
      }: -${formatUsdt(order.discountAmount)}`,
    );
  }
  lines.push(`${t.orderDetail.receiptTotal}: ${formatUsdt(order.totalAmount)}`);
  return lines.join('\n');
}

/* ---------- copy buttons (Copy → Check swap, 1.5s) ---------- */

function CopyLineButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={t.common.copy}
      aria-label={t.orderDetail.copyLine}
      className={cn(
        'shrink-0 cursor-pointer rounded-md p-1.5 transition-all',
        copied
          ? 'text-emerald-600'
          : 'text-neutral-400 hover:bg-neutral-200 hover:text-neutral-950 sm:opacity-0 sm:group-hover:opacity-100',
      )}
    >
      {copied ? (
        <Check className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}

function CopyAllButton({ lines }: { lines: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(lines.join('\n'));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={1.75} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {copied ? t.common.copied : t.orderDetail.copyAll}
    </Button>
  );
}

/* ---------- page ---------- */

export default function OrderDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      }
    >
      <OrderDetailContent code={code} />
    </Suspense>
  );
}

function OrderDetailContent({ code }: { code: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justPaid = searchParams.get('paid') === '1';
  const { user, token, loading: authLoading } = useAuth();
  const { t, formatDate } = useI18n();

  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(`/orders/${code}`)}`);
      return;
    }
    let active = true;
    apiFetch<OrderDetailDto>(`/orders/${code}`, { token })
      .then((data) => {
        if (active) setOrder(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [authLoading, token, code, router, t]);

  if (missing) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <EmptyState
          icon={PackageSearch}
          title={t.checkout.notFoundTitle}
          hint={t.checkout.notFoundHint}
          action={
            <Link href="/orders" className={buttonVariants({ variant: 'outline' })}>
              {t.nav.myOrders}
            </Link>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
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
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  const showPaidBanner = justPaid && (order.status === 'PAID' || order.status === 'DELIVERED');
  const partiallyMissing =
    order.status === 'PAID' &&
    order.items.some((item) => (item.deliveredLines?.length ?? 0) < item.quantity);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-950"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        {t.nav.myOrders}
      </Link>

      {showPaidBanner && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-600/20 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          <CheckCircle2 className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          {t.orderDetail.paidBanner}
        </div>
      )}

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight">{order.code}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadTxt(`don-hang-${order.code}.txt`, buildReceipt(order, user, t, formatDate))
              }
            >
              <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t.orderDetail.downloadReceipt}
            </Button>
            {order.status === 'PENDING' && (
              <Link href={`/checkout/${order.code}`} className={buttonVariants({ size: 'sm' })}>
                {t.orderDetail.continuePayment}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Link>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-500">{t.orderDetail.createdAt}</dt>
            <dd className="mt-0.5 font-medium">{formatDate(order.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">{t.orderDetail.paidAt}</dt>
            <dd className="mt-0.5 font-medium">{formatDate(order.paidAt)}</dd>
          </div>
          {order.discountAmount > 0 && (
            <>
              <div>
                <dt className="text-neutral-500">{t.orderDetail.subtotal}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {formatUsdt(order.subtotalAmount)}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">
                  {t.orderDetail.discount}
                  {order.couponCode && (
                    <span className="ml-1 font-mono text-xs">({order.couponCode})</span>
                  )}
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  −{formatUsdt(order.discountAmount)}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-neutral-500">{t.orderDetail.totalAmount}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatUsdt(order.totalAmount)}</dd>
          </div>
          {order.status === 'PENDING' && (
            <div>
              <dt className="text-neutral-500">{t.orderDetail.expiresAt}</dt>
              <dd className="mt-0.5 font-medium">{formatDate(order.expiresAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      {partiallyMissing && (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
          <Clock className="h-5 w-5 shrink-0 text-neutral-500" strokeWidth={1.75} />
          {t.orderDetail.partialNotice}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {order.items.map((item) => {
          const lines = item.deliveredLines ?? [];
          return (
            <Card key={item.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-950">
                    {item.productName}
                    {item.variantName && <Badge variant="muted">{item.variantName}</Badge>}
                  </p>
                  <p className="mt-0.5 text-sm tabular-nums text-neutral-500">
                    {formatUsdt(item.unitPrice)} × {item.quantity}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <p className="font-semibold tabular-nums">
                    {formatUsdt(item.unitPrice * item.quantity)}
                  </p>
                  <Link
                    href={`/products/${item.productSlug}`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t.orderDetail.buyAgain}
                  </Link>
                </div>
              </div>

              {lines.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t.orderDetail.deliveredTitle(lines.length)}</p>
                    <div className="flex gap-2">
                      <CopyAllButton lines={lines} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadTxt(`${order.code}.txt`, lines.join('\n'))}
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {t.orderDetail.downloadTxt}
                      </Button>
                    </div>
                  </div>
                  <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-neutral-50">
                    {lines.map((line, index) => (
                      <div
                        key={index}
                        className="group flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="break-all font-mono text-sm">{line}</span>
                        <CopyLineButton text={line} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
