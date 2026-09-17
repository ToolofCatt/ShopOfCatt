'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  Copy,
  ExternalLink,
  FlaskConical,
  Landmark,
  PackageSearch,
  RefreshCw,
  ServerCrash,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import {
  type CheckPaymentDto,
  type OrderDetailDto,
  type PaymentMethod,
  type PaymentMethodDto,
} from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { usePendingOrderReminder } from '@/lib/pending-order-reminder';
import { usePrices } from '@/lib/prices';
import { createPaymentCheckGate, getPaymentUi, PAYMENT_POLL_INTERVAL_MS } from '@/lib/payment-ui';
import { PaymentMethodTabs } from '@/components/payment-method-tabs';
import { formatCryptoAmount } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Input, Label, Spinner, buttonVariants } from '@/components/ui';
import { SupportPanel } from '@/components/support-panel';
import { useStorefront } from '@/lib/storefront';

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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

/** Nút sao chép nhỏ — đổi Copy → Check trong 1.5s. */
function CopyIconButton({ text, label }: { text: string; label: string }) {
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
      title={copied ? t.common.copied : label}
      aria-label={copied ? t.common.copied : label}
      className="shrink-0 cursor-pointer rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
    >
      {copied ? (
        <Check className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={1.75} />
      )}
    </button>
  );
}

/** Một dòng "nhãn — giá trị" kèm nút sao chép, dùng cho thông tin chuyển khoản. */
function CopyRow({
  label,
  value,
  copyText,
  strong = false,
}: {
  label: string;
  value: string;
  copyText: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'truncate font-mono text-neutral-950',
            strong ? 'text-base font-semibold' : 'font-medium',
          )}
        >
          {value}
        </span>
        <CopyIconButton text={copyText} label={label} />
      </dd>
    </div>
  );
}

export default function PaymentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const { t, formatDate } = useI18n();
  const store = useStorefront();
  const readOnly = !store.published || store.maintenanceMode;
  const { orderMoney, priceUsdt } = usePrices();

  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);
  const [paymentCheckGate] = useState(createPaymentCheckGate);

  // Khi chưa có phiên, vẫn cho chọn lại dù chỉ một phương thức đang bật.
  const [methods, setMethods] = useState<PaymentMethodDto[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  /*
    Nhắc khách quay lại khi họ rời tab mà đơn còn chưa trả tiền.

    Gọi ở đây, TRƯỚC các nhánh return sớm bên dưới (đang tải, không thấy đơn, đã
    hết hạn): React đòi số lần gọi hook giống nhau ở mọi lần render, đặt sau một
    `return` là app nổ ngay khi trạng thái đổi.
  */
  usePendingOrderReminder(order?.status === 'PENDING' && !readOnly && (!order.expiresAt || new Date(order.expiresAt).getTime() > now), {
    tabTitle: `${order?.code ?? ''} — ${t.customerUx.pendingTitle}`,
    notifyTitle: t.customerUx.pendingTitle,
    notifyBody: t.customerUx.pendingHint,
  });

  // Xác nhận thủ công bằng TxID (chỉ với thanh toán CRYPTO).
  const [txId, setTxId] = useState('');
  const [txSubmitting, setTxSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // Load the order once auth is resolved.
  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(`/checkout/${code}`)}`);
      return;
    }
    let active = true;
    apiFetch<OrderDetailDto>(`/orders/${code}`, { token })
      .then((data) => {
        if (!active) return;
        if (data.status !== 'PENDING') {
          redirectingRef.current = true;
          router.replace(`/orders/${code}`);
          return;
        }
        setOrder(data);
        setLastUpdated(new Date().toISOString());
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

  // Danh sách phương thức đang bật (endpoint công khai).
  useEffect(() => {
    let active = true;
    apiFetch<PaymentMethodDto[]>('/payment-methods')
      .then((data) => {
        if (active) setMethods(data);
      })
      .catch(() => {
        // Không tải được → ẩn chooser, đơn vẫn thanh toán được bằng phiên hiện tại.
        if (active) setMethods([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // 1-second ticker for the countdown.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const expiresAtMs = order?.expiresAt ? new Date(order.expiresAt).getTime() : null;
  const remainingMs = expiresAtMs !== null ? expiresAtMs - now : null;
  const expired = remainingMs !== null && remainingMs <= 0;

  const paymentUi = getPaymentUi(order?.payment ?? null, methods, code);
  const selectedMethod = paymentUi.method;
  const canCheckPayment = paymentUi.canCheckPayment && !readOnly;
  const pending = order?.status === 'PENDING';

  const checkPayment = useCallback(
    async (manual: boolean) => {
      if (!token || !pending || switching || redirectingRef.current) return;
      try {
        const ran = await paymentCheckGate.run(async (isCurrent) => {
          if (manual) setChecking(true);
          try {
            // Chưa có phiên thì chỉ đọc lại đơn, không POST xác nhận hay giả lập.
            const result = canCheckPayment && !expired
              ? await apiFetch<CheckPaymentDto>(`/orders/${code}/check-payment`, { method: 'POST', token })
              : await apiFetch<OrderDetailDto>(`/orders/${code}`, { token });
            if (!isCurrent() || redirectingRef.current) return;
            setLastUpdated(new Date().toISOString());
            setUpdateError(false);
            if (manual) setCheckMessage(t.customerUx.manualPending);
            if (result.status === 'PAID' || result.status === 'DELIVERED') {
              redirectingRef.current = true;
              router.push(`/orders/${code}?paid=1`);
            } else if (result.status !== 'PENDING') {
              redirectingRef.current = true;
              router.replace(`/orders/${code}`);
            } else if ('payment' in result) {
              setOrder(result);
            }
          } finally {
            if (manual) setChecking(false);
          }
        });
        if (!ran && manual) setCheckMessage(t.customerUx.cooldown);
      } catch {
        setUpdateError(true);
        if (manual) setCheckMessage(null);
      }
    },
    [token, code, router, pending, expired, switching, canCheckPayment, paymentCheckGate, t.customerUx],
  );

  useEffect(() => () => paymentCheckGate.invalidate(), [code, token, paymentCheckGate]);

  // Phụ thuộc trạng thái thay vì cả đơn: đọc lại phiên không đặt lại nhịp polling.
  useEffect(() => {
    if (!pending || switching) return;
    const id = window.setInterval(() => { void checkPayment(false); }, PAYMENT_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pending, expired, switching, checkPayment]);

  /** Đổi phương thức: API cấu hình lại phiên thanh toán rồi trả về đơn mới. */
  const handleSelectMethod = async (method: PaymentMethod) => {
    if (readOnly || !token || !pending || expired || switching || redirectingRef.current || method === selectedMethod || paymentUi.kind === 'BALANCE' || !methods?.some((entry) => entry.method === method)) return;
    paymentCheckGate.invalidate();
    setSwitching(true);
    setSwitchError(null);
    setTxError(null);
    try {
      const refreshed = await apiFetch<OrderDetailDto>(`/orders/${code}/select-payment`, {
        method: 'POST',
        body: { method },
        token,
      });
      setOrder(refreshed);
    } catch (err) {
      setSwitchError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSwitching(false);
    }
  };

  const handleSubmitTx = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = txId.trim();
    if (readOnly || !token || !trimmed || txSubmitting || switching || expired || !pending || paymentUi.kind !== 'CRYPTO' || redirectingRef.current) return;
    setTxSubmitting(true);
    setTxError(null);
    try {
      const result = await apiFetch<CheckPaymentDto>(`/orders/${code}/submit-tx`, {
        method: 'POST',
        body: { txId: trimmed },
        token,
      });
      if (result.status === 'PAID' || result.status === 'DELIVERED') {
        redirectingRef.current = true;
        router.push(`/orders/${code}?paid=1`);
      }
    } catch (err) {
      setTxError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setTxSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (readOnly || !token || cancelling) return;
    if (!window.confirm(t.checkout.cancelConfirm)) return;
    setCancelling(true);
    try {
      await apiFetch<{ status: string }>(`/orders/${code}/cancel`, { method: 'POST', token });
      redirectingRef.current = true;
      router.push('/');
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setCancelling(false);
    }
  };

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

  if (error && !order) {
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

  if (expired || readOnly) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <Card className="space-y-4 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
            <Clock className="h-6 w-6 text-neutral-500" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">{expired ? t.checkout.expiredTitle : t.customerUx.maintenanceTitle}</h1>
            <p className="break-all font-mono text-sm">{order.code}</p>
            <p className="text-sm text-neutral-600">{expired ? t.customerUx.expiredHint(order.code) : t.customerUx.maintenanceCheckout}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" loading={checking} onClick={() => void checkPayment(true)}>{t.customerUx.refreshOrder}</Button>
            <Link href={`/orders/${order.code}`} className={buttonVariants({ variant: 'outline' })}>
              {t.checkout.viewOrder}
            </Link>
          </div>
          <div aria-live="polite" className="space-y-1 text-sm text-neutral-600">
            {lastUpdated && <p>{t.customerUx.lastUpdated}: <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time></p>}
            {checkMessage && <p>{checkMessage}</p>}
            {updateError && <p role="alert">{t.customerUx.checkError}</p>}
          </div>
        </Card>
        <div className="mt-4"><SupportPanel reference={order.code} hint={t.customerUx.sentPaymentHint} /></div>
      </div>
    );
  }

  const payment = order.payment;
  /*
    Ba con số tiền quy về đơn vị khách đang xem, lấy một lượt để hoá đơn cộng
    khớp — ₫ làm tròn lên nên quy riêng từng số là lệch 1 đồng.
  */
  const tien = orderMoney(order.subtotalAmount, order.discountAmount, order.totalAmount);
  const cryptoAmountText =
    payment?.cryptoAmount !== undefined ? formatCryptoAmount(payment.cryptoAmount) : '';
  const qrSrc = switching ? null : paymentUi.qrSrc;

  /*
    Tên chủ tài khoản đọc từ CẤU HÌNH HIỆN TẠI, không chụp vào đơn như số tài
    khoản và ngân hàng: nó chỉ để khách đối chiếu cho yên tâm, đổi tên hiển thị
    không làm tiền đi sai chỗ. Chụp thêm một cột nữa chỉ vì chuyện hiển thị là
    không đáng.
  */
  const sepayHolder =
    payment?.mode === 'SEPAY'
      ? (methods?.find((m) => m.method === 'sepay')?.accountHolder ?? null)
      : null;
  /** Số VND đã chốt trong đơn, định dạng theo ngôn ngữ đang xem. */
  const vndText =
    payment?.vndAmount !== undefined
      ? new Intl.NumberFormat('vi-VN').format(payment.vndAmount)
      : '';

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4">
      <Card className="p-5">
        {/*
          Đầu trang gói trong MỘT hàng thay vì xếp dọc giữa trang: cả trang phải
          nằm gọn trong một khung hình, khách không phải cuộn mới thấy mã QR.
        */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-neutral-100 pb-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{t.checkout.title}</h1>
            <p className="font-mono text-sm text-neutral-500">{order.code}</p>
          </div>
          <div className="text-right">
            {/*
              Hiện theo đơn vị khách đang xem, không phải USDT: sản phẩm neo giá
              theo ₫ thì con số ở đây phải khớp với số in trên mã QR chuyển khoản.
              Số USDT chính xác vẫn hiện đủ chữ số trong khối thanh toán crypto.
            */}
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {tien.total}
            </p>
            {order.discountAmount > 0 && (
              <p className="text-sm text-neutral-500">
                <span className="line-through">{tien.subtotal}</span>{' '}
                <span className="font-medium text-neutral-950">−{tien.discount}</span>
                {order.couponCode && (
                  <span className="ml-1 font-mono text-xs">({order.couponCode})</span>
                )}
              </p>
            )}
            {remainingMs !== null && (
              <p className="flex items-center justify-end gap-1.5 text-sm text-neutral-500">
                <Clock className="h-4 w-4" strokeWidth={1.75} />
                {t.checkout.expiresIn}{' '}
                <span className="font-mono font-medium tabular-nums text-neutral-950">
                  {formatCountdown(remainingMs)}
                </span>
              </p>
            )}
          </div>
        </div>

        <div
          className={cn(
            'mt-4 grid gap-6',
            qrSrc && 'lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start',
          )}
        >
          <div className="min-w-0 space-y-4">

        {/*
          Đang trả tiền cho CÁI GÌ. Trước đây trang này chỉ có mã đơn và số tiền,
          nên khách bấm nhầm sản phẩm cũng không có cách nào nhận ra trước khi trả.
        */}
        <ul className="space-y-2 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium text-neutral-950">{item.productName}</span>
                {item.variantName && (
                  <span className="text-neutral-500"> · {item.variantName}</span>
                )}
                <span className="block text-xs text-neutral-500">
                  {priceUsdt(item.unitPrice).primary} × {item.quantity}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-950">
                {priceUsdt(item.unitPrice * item.quantity).primary}
              </span>
            </li>
          ))}
        </ul>

        {methods !== null && methods.length > 0 && paymentUi.kind !== 'BALANCE' && (methods.length > 1 || !selectedMethod) && (
          <div className="space-y-2">
            <p className="text-center text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t.checkout.methodTitle}
            </p>
            {selectedMethod ? (
              <PaymentMethodTabs
                methods={methods.map((m) => m.method)}
                labels={t.checkout.methodsShort}
                value={selectedMethod}
                onChange={(method) => void handleSelectMethod(method)}
                disabled={switching}
              />
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {methods.map(({ method }) => (
                  <Button key={method} variant="outline" size="sm" disabled={switching} onClick={() => void handleSelectMethod(method)}>
                    {t.checkout.methods[method]}
                  </Button>
                ))}
              </div>
            )}
            {switchError && <p role="alert" className="text-center text-sm text-red-600">{switchError}</p>}
          </div>
        )}

        <div inert={switching} className={cn(switching && 'pointer-events-none opacity-50')}>
          {switching && (
            <div className="mb-3 flex justify-center">
              <Spinner className="h-5 w-5 text-neutral-400" />
            </div>
          )}

          {paymentUi.mockPayUrl ? (
            <div className="space-y-3 rounded-lg border border-dashed border-neutral-300 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FlaskConical className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {t.checkout.mockBadge}
              </p>
              <p className="text-sm text-neutral-500">{t.checkout.mockDescription}</p>
              <Link href={paymentUi.mockPayUrl} className={buttonVariants({ className: 'w-full' })}>
                {t.checkout.openMock}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </div>
          ) : payment?.mode === 'BINANCE_ID' ? (
            /*
              Chuyển thẳng tới Binance ID cá nhân của chủ shop.
              Không có ô nhập mã giao dịch như bên on-chain: giao dịch Pay được
              bộ đối soát nền nhận ra trong vòng một phút, còn khách thì chẳng
              có mã nào tiện tay để dán.
            */
            <div className="space-y-3 rounded-lg border border-neutral-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {t.checkout.binanceIdTitle}
                </p>
                <Badge variant="solid">Binance Pay</Badge>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.cryptoAmountLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-2xl font-semibold tabular-nums text-neutral-950">
                    {cryptoAmountText}
                    <span className="ml-1.5 text-sm font-medium text-neutral-500">USDT</span>
                  </span>
                  <CopyIconButton text={cryptoAmountText} label={t.checkout.copyAmount} />
                </div>
                {/*
                  KHÔNG dùng cryptoExactWarning ở đây: câu đó nói đơn được nhận
                  diện qua số tiền, đúng với on-chain nhưng sai với Binance Pay —
                  bên này nhận diện qua ghi chú. Số tiền vẫn phải đúng vì bộ đối
                  soát còn đối chiếu cả số.
                */}
                <p className="text-xs text-neutral-500">{t.checkout.binanceIdExactHint}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.binanceIdLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-lg font-semibold tabular-nums text-neutral-950">
                    {payment.binanceId}
                  </span>
                  <CopyIconButton
                    text={payment.binanceId ?? ''}
                    label={t.checkout.copyBinanceId}
                  />
                </div>
              </div>

              {/*
                GHI CHÚ là thứ chỉ ra đơn nào. Số tiền nay đúng bằng giá bán, nên
                hai khách mua cùng sản phẩm chuyển hai khoản giống hệt nhau —
                không ghi mã đơn thì hệ thống không dám khớp và đơn phải chờ chủ
                shop đối soát tay.
              */}
              <div className="space-y-1.5 border-t border-neutral-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.binanceIdMemoLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2.5">
                  <span className="break-all font-mono text-lg font-semibold text-neutral-950">
                    {order.code}
                  </span>
                  <CopyIconButton text={order.code} label={t.checkout.copyMemo} />
                </div>
                <p className="flex items-start gap-1.5 text-xs font-medium text-neutral-950">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {t.checkout.binanceIdMemoHint}
                </p>
              </div>
            </div>
          ) : payment?.mode === 'SEPAY' ? (
            /*
              Chuyển khoản ngân hàng VND. Ba thứ khách cần: SỐ TIỀN, TÀI KHOẢN,
              và NỘI DUNG. Nội dung là mã đơn — thiếu nó thì bộ khớp không tìm ra
              đơn nào và tiền nằm đó chờ đối soát tay.
            */
            <div className="space-y-3 rounded-lg border border-neutral-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Landmark className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {t.checkout.sepayTitle}
                </p>
                {payment.sepayBank && <Badge variant="solid">{payment.sepayBank}</Badge>}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.sepayAmountLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-2xl font-semibold tabular-nums text-neutral-950">
                    {vndText}
                    <span className="ml-1.5 text-sm font-medium text-neutral-500">VND</span>
                  </span>
                  <CopyIconButton
                    text={String(payment.vndAmount ?? '')}
                    label={t.checkout.copyAmount}
                  />
                </div>
                <p className="flex items-start gap-1.5 text-xs font-medium text-neutral-950">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {t.checkout.sepayExactHint}
                </p>
                {cryptoAmountText && (
                  <p className="text-xs text-neutral-500">
                    {t.checkout.sepayRate(cryptoAmountText)}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.sepayAccountLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-lg font-semibold tabular-nums text-neutral-950">
                    {payment.sepayAccountNumber}
                  </span>
                  <CopyIconButton
                    text={payment.sepayAccountNumber ?? ''}
                    label={t.checkout.copyAccount}
                  />
                </div>
                {sepayHolder && (
                  <p className="text-xs text-neutral-500">
                    {t.checkout.sepayHolderLabel}: {sepayHolder}
                  </p>
                )}
              </div>

              <div className="space-y-1.5 border-t border-neutral-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.sepayMemoLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2.5">
                  <span className="break-all font-mono text-lg font-semibold text-neutral-950">
                    {order.code}
                  </span>
                  <CopyIconButton text={order.code} label={t.checkout.copyMemo} />
                </div>
                <p className="flex items-start gap-1.5 text-xs font-medium text-neutral-950">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {t.checkout.sepayMemoHint}
                </p>
              </div>
            </div>
          ) : payment?.mode === 'CRYPTO' && paymentUi.kind === 'CRYPTO' ? (
            <div className="space-y-3 rounded-lg border border-neutral-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {t.checkout.cryptoTitle}
                </p>
                <Badge variant="solid">{payment.cryptoNetwork}</Badge>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.cryptoAmountLabel}
                </p>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-2xl font-semibold tabular-nums text-neutral-950">
                    {cryptoAmountText}
                    <span className="ml-1.5 text-sm font-medium text-neutral-500">USDT</span>
                  </span>
                  <CopyIconButton text={cryptoAmountText} label={t.checkout.copyAmount} />
                </div>
                <p className="flex items-start gap-1.5 text-xs font-medium text-neutral-950">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  {t.checkout.cryptoExactWarning}
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {t.checkout.cryptoAddressLabel}
                </p>
                <div className="flex items-start justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="break-all font-mono text-[13px] leading-5 text-neutral-950">
                    {payment.cryptoAddress}
                  </span>
                  <CopyIconButton
                    text={payment.cryptoAddress ?? ''}
                    label={t.checkout.copyAddress}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {t.checkout.cryptoNetworkNote(payment.cryptoNetwork ?? '')}
                </p>
              </div>

              <form
                onSubmit={(event) => void handleSubmitTx(event)}
                className="space-y-1.5 border-t border-neutral-100 pt-3"
              >
                {/*
                  Bỏ nhãn nổi để trang gọn trong một khung hình — chỗ nhập đã có
                  chữ gợi ý, còn trình đọc màn hình vẫn có `aria-label`.
                */}
                <div className="flex gap-2">
                  <Input
                    id="crypto-txid"
                    aria-label={t.checkout.cryptoTxIdLabel}
                    value={txId}
                    onChange={(event) => setTxId(event.target.value)}
                    placeholder={t.checkout.cryptoTxIdPlaceholder}
                    className="font-mono text-[13px]"
                  />
                  <Button type="submit" loading={txSubmitting} disabled={!txId.trim()}>
                    {t.checkout.cryptoSubmitTx}
                  </Button>
                </div>
                {txError && <p className="text-sm text-red-600">{txError}</p>}
                <p className="text-xs text-neutral-500">{t.checkout.cryptoTxHint}</p>
              </form>
            </div>
          ) : paymentUi.kind === 'BINANCE' ? (
            <div className="space-y-3 text-center">
              {paymentUi.checkoutUrl && (
                <a
                  href={paymentUi.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ className: 'w-full' })}
                >
                  {t.checkout.openBinance}
                  <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
                </a>
              )}
            </div>
          ) : (
            <div role="status" className="space-y-2 rounded-lg border border-neutral-200 p-3.5">
              <p className="flex items-center gap-2 text-sm font-medium">
                {paymentUi.kind === 'BALANCE' ? <Wallet className="h-4 w-4 shrink-0" strokeWidth={1.75} /> : <Clock className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
                {paymentUi.kind === 'BALANCE' ? t.paymentMode.BALANCE : paymentUi.kind === 'INITIALIZING' ? t.checkout.initializingTitle : t.checkout.unavailableTitle}
              </p>
              <p className="text-sm text-neutral-500">
                {paymentUi.kind === 'BALANCE' ? t.checkout.balancePendingHint : t.checkout.initializingHint}
              </p>
              {paymentUi.kind !== 'BALANCE' && methods?.length === 0 && (
                <p className="text-sm text-neutral-500">{t.product.noPaymentMethod}</p>
              )}
            </div>
          )}
        </div>

        <div aria-live="polite" className="space-y-1 text-sm text-neutral-600">
          <p className="font-medium text-neutral-950">{t.customerUx.pendingTitle}</p>
          <p>{t.customerUx.pendingHint}</p>
          {lastUpdated && <p>{t.customerUx.lastUpdated}: <time dateTime={lastUpdated}>{formatDate(lastUpdated)}</time></p>}
          {checkMessage && <p>{checkMessage}</p>}
          {updateError && <p role="alert">{t.customerUx.checkError}</p>}
        </div>
        {error && <p className="text-center text-sm text-red-600">{error}</p>}

        {/*
          Dòng "đang tự kiểm tra" gộp vào hàng nút thay vì chiếm một dòng riêng —
          cả trang phải nằm gọn trong một khung hình.
        */}
        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          <span className="flex items-center gap-1.5 text-xs text-neutral-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neutral-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-neutral-500" />
            </span>
            {canCheckPayment ? t.checkout.autoChecking : t.checkout.autoRefreshing}
          </span>
          <span className="ml-auto flex gap-2">
            {canCheckPayment && (
              <Button
                variant="ghost"
                size="sm"
                loading={checking}
                disabled={switching}
                onClick={() => void checkPayment(true)}
              >
                {!checking && <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {t.checkout.checkNow}
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              onClick={() => void handleCancel()}
            >
              {t.checkout.cancelOrder}
            </Button>
          </span>
        </div>
          </div>

          {/*
            CỘT PHẢI: chỉ mã QR. Trước đây QR nằm lẫn trong khối thông tin nên
            trang dài quá một khung hình, khách phải cuộn mới thấy thứ cần quét.
            `lg:sticky` để QR luôn trong tầm mắt nếu cột trái dài ra.
          */}
          {qrSrc && (
            <div className="flex flex-col items-center gap-2 lg:sticky lg:top-24">
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrSrc}
                  alt={
                    payment?.sepayQrUrl
                      ? t.checkout.sepayQrAlt
                      : payment?.cryptoQr
                        ? t.checkout.cryptoQrAlt
                        : t.checkout.qrAlt(order.code)
                  }
                  className="h-52 w-52"
                />
              </div>
              {/*
                Với QR địa chỉ ví phải nói rõ mã KHÔNG chứa số tiền: quét xong
                tưởng đã xong rồi gửi tròn số là tiền vào ví mà đơn không khớp
                được, lúc đó phải nhờ admin đối soát tay.
              */}
              {/*
                QR của SePay khác QR ví crypto: nó đã chứa SẴN số tiền và nội
                dung, nên câu nhắc phải khác — nói "mã không chứa số tiền" ở đây
                là sai và làm khách tự gõ lại.
              */}
              <p className="max-w-[13rem] text-center text-xs text-neutral-500">
                {payment?.sepayQrUrl
                  ? t.checkout.sepayQrHint
                  : payment?.cryptoQr
                    ? t.checkout.cryptoQrHint
                    : t.checkout.scanQr}
              </p>
            </div>
          )}
        </div>
      </Card>
      <details className="mt-4 rounded-lg border border-neutral-200 p-4">
        <summary className="min-h-11 cursor-pointer font-medium">{t.customerUx.sentPaymentHelp}</summary>
        <SupportPanel reference={order.code} hint={t.customerUx.sentPaymentHint} />
      </details>
    </div>
  );
}
