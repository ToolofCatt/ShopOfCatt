'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, use, useCallback, useEffect, useMemo, useState } from 'react';
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
  formatUserCode,
  type OrderDetailDto,
  type PaymentInfoDto,
  type PublicUser,
} from '@webcatt/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { usePrices } from '@/lib/prices';
import type { Dictionary } from '@/lib/i18n';
import { formatCryptoAmount } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { wordmarkText } from '@/components/wordmark';
import { SupportPanel } from '@/components/support-panel';
import { useStorefront } from '@/lib/storefront';
import { getCustomerDelivery } from '@/lib/customer-order-state';
import { createPaymentCheckGate, PAYMENT_POLL_INTERVAL_MS } from '@/lib/payment-ui';

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

/** Tên phương thức thanh toán, dùng chung cho cả trang lẫn biên nhận. */
function paymentMethodName(payment: PaymentInfoDto, t: Dictionary): string {
  if (payment.mode === 'CRYPTO') {
    return t.product.payCrypto(payment.cryptoNetwork ?? '');
  }
  if (payment.mode === 'BINANCE') return t.product.payBinancePay;
  if (payment.mode === 'BINANCE_ID') return t.product.payBinanceId;
  if (payment.mode === 'SEPAY') return t.product.paySepay;
  if (payment.mode === 'BALANCE') return t.paymentMode.BALANCE;
  if (payment.mode === 'INITIALIZING') return t.checkout.initializingTitle;
  return t.product.payMock;
}

/* ---------- biên nhận .txt (nội dung theo ngôn ngữ đang chọn) ---------- */

function buildReceipt(
  order: OrderDetailDto,
  user: PublicUser | null,
  t: Dictionary,
  formatDate: (value: string | null | undefined) => string,
  /*
    Tiền của đơn ĐÃ quy về đơn vị khách đang xem. Truyền vào thay vì tự gọi
    `formatUsdt`: biên nhận ghi USDT trong khi trên màn hình là ₫ thì khách mang
    biên nhận đi đối chiếu với sao kê ngân hàng và không thấy con số nào khớp.
  */
  tien: { subtotal: string; discount: string; total: string },
  moiDong: (usdt: number) => string,
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
  if (order.payment) {
    lines.push(
      `${t.orderDetail.paymentMethodLabel}: ${paymentMethodName(order.payment, t)}`,
    );
    /*
      Với SePay khách chuyển VND, không phải USDT — ghi USDT vào biên nhận là
      một con số khách không hề chuyển, và họ sẽ mang nó đi đối chiếu.
    */
    if (order.payment.mode === 'SEPAY' && order.payment.vndAmount !== undefined) {
      lines.push(
        `${t.orderDetail.paymentSentAmount}: ${new Intl.NumberFormat('vi-VN').format(
          order.payment.vndAmount,
        )} VND`,
      );
    } else if (order.payment.cryptoAmount !== undefined) {
      lines.push(
        `${t.orderDetail.paymentSentAmount}: ${formatCryptoAmount(order.payment.cryptoAmount)} USDT`,
      );
    }
    if (order.payment.cryptoAddress) {
      lines.push(`${t.checkout.cryptoAddressLabel}: ${order.payment.cryptoAddress}`);
    }
    if (order.payment.cryptoTxId) {
      lines.push(`${t.checkout.cryptoTxIdLabel}: ${order.payment.cryptoTxId}`);
    }
    // `merchantTradeNo` được sinh cho MỌI thanh toán, không riêng Binance Pay —
    // chỉ dán nhãn Binance Pay khi đơn thật sự đi qua cổng đó.
    if (order.payment.mode === 'BINANCE' && order.payment.merchantTradeNo) {
      lines.push(`Binance Pay: ${order.payment.merchantTradeNo}`);
    }
  }
  lines.push('');
  order.items.forEach((item, index) => {
    const name = item.variantName
      ? `${item.productName} — ${item.variantName}`
      : item.productName;
    lines.push(
      `${index + 1}. ${name} | ${t.orderDetail.receiptQty} ${item.quantity} × ${moiDong(item.unitPrice)} = ${moiDong(item.unitPrice * item.quantity)}`,
    );
    for (const delivered of item.deliveredLines ?? []) {
      lines.push(`   ${delivered}`);
    }
  });
  lines.push('--------------------------------');
  if (order.discountAmount > 0) {
    lines.push(`${t.orderDetail.subtotal}: ${tien.subtotal}`);
    lines.push(
      `${t.orderDetail.discount}${
        order.couponCode ? ` (${order.couponCode})` : ''
      }: -${tien.discount}`,
    );
  }
  lines.push(`${t.orderDetail.receiptTotal}: ${tien.total}`);
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
  const store = useStorefront();
  const readOnly = !store.published || store.maintenanceMode;
  const { user, token, loading: authLoading } = useAuth();
  const { t, formatDate } = useI18n();
  const { orderMoney, priceUsdt } = usePrices();

  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [error, setError] = useState(false);
  const [missing, setMissing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const refreshGate = useMemo(createPaymentCheckGate, [code, token]);
  const refresh = useCallback(async () => {
    if (!token || authLoading) return;
    await refreshGate.run(async (isCurrent) => {
      setRefreshing(true);
      try {
        const data = await apiFetch<OrderDetailDto>(`/orders/${code}`, { token });
        if (!isCurrent()) return;
        setOrder(data);
        setError(false);
        setMissing(false);
        setLastUpdated(new Date().toISOString());
      } catch (err) {
        if (!isCurrent()) return;
        // Giữ nguyên key đã tải khi refresh lỗi; không thay bằng màn hình lỗi trắng.
        setMissing(err instanceof ApiError && err.status === 404);
        setError(true);
      } finally { if (isCurrent()) setRefreshing(false); }
    });
  }, [authLoading, token, code, refreshGate]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setOrder(null);
      router.replace(`/login?next=${encodeURIComponent(`/orders/${code}`)}`);
      return;
    }
    setOrder(null);
    setError(false);
    setMissing(false);
    setLastUpdated(null);
    void refresh();
    return () => refreshGate.invalidate();
  }, [authLoading, token, code, router, refresh, refreshGate]);

  useEffect(() => {
    if (!token || authLoading || (order && order.status !== 'PAID')) return;
    const id = window.setInterval(() => void refresh(), PAYMENT_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [order?.status, token, authLoading, refresh]);

  if (missing && !order) {
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

  if (error && !order) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <EmptyState
          icon={ServerCrash}
          title={t.common.serverDownTitle}
          hint={t.customerUx.checkError}
          action={
            <Button variant="outline" loading={refreshing} onClick={() => void refresh()}>
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

  /*
    Ba con số tiền quy về đơn vị khách đang xem, lấy MỘT lượt để hoá đơn cộng
    khớp — ₫ làm tròn lên nên quy riêng từng số là lệch một đồng.
  */
  const tien = orderMoney(order.subtotalAmount, order.discountAmount, order.totalAmount);

  const delivery = getCustomerDelivery(order);
  const showPaidBanner = delivery.kind !== 'unconfirmed';

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
          {t.customerUx.paymentConfirmed}
        </div>
      )}

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="break-all font-mono text-xl font-semibold tracking-tight">{order.code}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadTxt(
                  `${t.orderDetail.receiptFileName}-${order.code}.txt`,
                  buildReceipt(order, user, t, formatDate, tien, (u) => priceUsdt(u).primary),
                )
              }
            >
              <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t.orderDetail.downloadReceipt}
            </Button>
            {order.status === 'PENDING' && !readOnly && (
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
                <dd className="mt-0.5 font-medium tabular-nums">{tien.subtotal}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">
                  {t.orderDetail.discount}
                  {order.couponCode && (
                    <span className="ml-1 font-mono text-xs">({order.couponCode})</span>
                  )}
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">−{tien.discount}</dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-neutral-500">{t.orderDetail.totalAmount}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{tien.total}</dd>
          </div>
          {order.status === 'PENDING' && (
            <div>
              <dt className="text-neutral-500">{t.orderDetail.expiresAt}</dt>
              <dd className="mt-0.5 font-medium">{formatDate(order.expiresAt)}</dd>
            </div>
          )}
        </dl>

        {/*
          Thông tin thanh toán hiện thẳng ở đây.

          Trước đây trang này không nói gì về việc đơn được trả bằng cách nào —
          muốn biết mạng nào, gửi vào ví nào, TxID bao nhiêu thì chỉ còn cách tải
          file .txt về đọc. Mà file đó cũng chưa có mấy thông tin này.
        */}
        {order.payment && (
          <div className="mt-4 border-t border-neutral-100 pt-4">
            <p className="text-sm font-medium text-neutral-950">
              {t.orderDetail.paymentTitle}
            </p>
            <dl className="mt-2.5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-neutral-500">{t.orderDetail.paymentMethodLabel}</dt>
                <dd className="mt-0.5 font-medium">
                  {paymentMethodName(order.payment, t)}
                </dd>
              </div>
              {order.payment.mode === 'SEPAY' &&
              order.payment.vndAmount !== undefined ? (
                <div>
                  <dt className="text-neutral-500">{t.orderDetail.paymentSentAmount}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {new Intl.NumberFormat('vi-VN').format(order.payment.vndAmount)} VND
                  </dd>
                </div>
              ) : null}
              {order.payment.mode !== 'SEPAY' && order.payment.cryptoAmount !== undefined && (
                <div>
                  <dt className="text-neutral-500">{t.orderDetail.paymentSentAmount}</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">
                    {formatCryptoAmount(order.payment.cryptoAmount)} USDT
                  </dd>
                </div>
              )}
              {order.payment.binanceId && (
                <div>
                  <dt className="text-neutral-500">{t.checkout.binanceIdLabel}</dt>
                  <dd className="mt-0.5 flex items-start gap-1">
                    <span className="break-all font-mono text-xs leading-5">
                      {order.payment.binanceId}
                    </span>
                    <CopyLineButton text={order.payment.binanceId} />
                  </dd>
                </div>
              )}
              {order.payment.cryptoAddress && (
                <div className="sm:col-span-2">
                  <dt className="text-neutral-500">{t.checkout.cryptoAddressLabel}</dt>
                  <dd className="mt-0.5 flex items-start gap-1">
                    <span className="break-all font-mono text-xs leading-5">
                      {order.payment.cryptoAddress}
                    </span>
                    <CopyLineButton text={order.payment.cryptoAddress} />
                  </dd>
                </div>
              )}
              {order.payment.cryptoTxId && (
                <div className="sm:col-span-2">
                  <dt className="text-neutral-500">{t.checkout.cryptoTxIdLabel}</dt>
                  <dd className="mt-0.5 flex items-start gap-1">
                    <span className="break-all font-mono text-xs leading-5">
                      {order.payment.cryptoTxId}
                    </span>
                    <CopyLineButton text={order.payment.cryptoTxId} />
                  </dd>
                </div>
              )}
              {order.payment.mode === 'BINANCE' && order.payment.merchantTradeNo && (
                <div className="sm:col-span-2">
                  <dt className="text-neutral-500">Binance Pay</dt>
                  <dd className="mt-0.5 flex items-start gap-1">
                    <span className="break-all font-mono text-xs leading-5">
                      {order.payment.merchantTradeNo}
                    </span>
                    <CopyLineButton text={order.payment.merchantTradeNo} />
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </Card>

      <section aria-live="polite" className="mt-4 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
        <div className="flex items-start gap-2.5">
          <Clock className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-semibold text-neutral-950">{delivery.kind === 'waiting' ? t.customerUx.waitingDelivery : delivery.kind === 'partial' ? t.customerUx.partialDelivery(delivery.delivered, delivery.total) : delivery.kind === 'available' ? t.customerUx.keysAvailable : delivery.kind === 'delivered' ? t.customerUx.delivered : t.orderStatus[order.status]}</p>
            <p className="mt-1">{delivery.kind === 'waiting' ? t.customerUx.waitingDeliveryHint : delivery.kind === 'partial' ? t.customerUx.partialDeliveryHint : delivery.kind === 'available' ? t.customerUx.keysAvailableHint : delivery.kind === 'delivered' ? t.customerUx.deliveredHint : order.status === 'EXPIRED' ? t.customerUx.expiredHint(order.code) : t.customerUx.pendingHint}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" className="min-h-11" loading={refreshing} onClick={() => void refresh()}>{t.customerUx.refreshOrder}</Button>
          {lastUpdated && <p>{t.customerUx.lastUpdated}: <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time></p>}
        </div>
        {error && <p role="alert">{t.customerUx.checkError}</p>}
      </section>

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
                    {priceUsdt(item.unitPrice).primary} × {item.quantity}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <p className="font-semibold tabular-nums">
                    {priceUsdt(item.unitPrice * item.quantity).primary}
                  </p>
                  {!readOnly && <Link
                    href={`/products/${item.productSlug}`}
                    className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-mr-2' })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t.orderDetail.buyAgain}
                  </Link>}
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
                        onClick={() =>
                          downloadTxt(
                            `${t.orderDetail.keysFileName}-${order.code}.txt`,
                            lines.join('\n'),
                          )
                        }
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
      <div className="mt-4"><SupportPanel reference={order.code} /></div>
    </div>
  );
}
