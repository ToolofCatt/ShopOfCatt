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
  formatUsdt,
  type CheckPaymentDto,
  type OrderDetailDto,
  type PaymentInfoDto,
  type PaymentMethod,
  type PaymentMethodDto,
} from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { formatCryptoAmount } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, EmptyState, Input, Label, Spinner, buttonVariants } from '@/components/ui';
import { Tabs } from '@/components/admin/tabs';

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Phương thức tương ứng với phiên thanh toán hiện tại của đơn. */
function methodOfPayment(payment: PaymentInfoDto | null): PaymentMethod | null {
  if (!payment) return null;
  if (payment.mode === 'MOCK') return 'mock';
  if (payment.mode === 'BINANCE') return 'binance_pay';
  return payment.cryptoNetwork === 'TRC20' ? 'crypto_trc20' : 'crypto_bep20';
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
  const { t } = useI18n();

  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const redirectingRef = useRef(false);

  // Phương thức thanh toán đang bật (chooser chỉ hiện khi có nhiều hơn 1).
  const [methods, setMethods] = useState<PaymentMethodDto[] | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

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

  const checkPayment = useCallback(
    async (manual: boolean) => {
      if (!token || redirectingRef.current) return;
      if (manual) setChecking(true);
      try {
        const result = await apiFetch<CheckPaymentDto>(`/orders/${code}/check-payment`, {
          method: 'POST',
          token,
        });
        if (result.status === 'PAID' || result.status === 'DELIVERED') {
          redirectingRef.current = true;
          router.push(`/orders/${code}?paid=1`);
        }
      } catch {
        // polling errors are transient — ignore silently
      } finally {
        if (manual) setChecking(false);
      }
    },
    [token, code, router],
  );

  // Poll every 4 seconds while the order is payable.
  useEffect(() => {
    if (!order || expired) return;
    const id = window.setInterval(() => {
      void checkPayment(false);
    }, 4000);
    return () => window.clearInterval(id);
  }, [order, expired, checkPayment]);

  const selectedMethod = methodOfPayment(order?.payment ?? null);

  /** Đổi phương thức: API cấu hình lại phiên thanh toán rồi trả về đơn mới. */
  const handleSelectMethod = async (method: PaymentMethod) => {
    if (!token || switching || redirectingRef.current || method === selectedMethod) return;
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
    if (!token || !trimmed || txSubmitting || redirectingRef.current) return;
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
    if (!token || cancelling) return;
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

  if (expired) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <Card className="space-y-4 p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
            <Clock className="h-6 w-6 text-neutral-500" strokeWidth={1.75} />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">{t.checkout.expiredTitle}</h1>
            <p className="text-sm text-neutral-500">{t.checkout.expiredHint(order.code)}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Link href="/" className={buttonVariants({})}>
              {t.checkout.backHome}
            </Link>
            <Link href={`/orders/${order.code}`} className={buttonVariants({ variant: 'outline' })}>
              {t.checkout.viewOrder}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const payment = order.payment;
  const mockPayUrl = payment?.mockPayUrl || `/mock-pay/${order.code}`;
  const cryptoAmountText =
    payment?.cryptoAmount !== undefined ? formatCryptoAmount(payment.cryptoAmount) : '';

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card className="space-y-6 p-6">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{t.checkout.title}</h1>
          <p className="font-mono text-sm text-neutral-500">{order.code}</p>
          <p className="text-4xl font-semibold tabular-nums tracking-tight">
            {formatUsdt(order.totalAmount)}
          </p>
          {order.discountAmount > 0 && (
            <p className="text-sm text-neutral-500">
              <span className="line-through">{formatUsdt(order.subtotalAmount)}</span>{' '}
              <span className="font-medium text-neutral-950">
                −{formatUsdt(order.discountAmount)}
              </span>
              {order.couponCode && (
                <span className="ml-1 font-mono text-xs">({order.couponCode})</span>
              )}
            </p>
          )}
          {remainingMs !== null && (
            <p className="flex items-center justify-center gap-1.5 text-sm text-neutral-500">
              <Clock className="h-4 w-4" strokeWidth={1.75} />
              {t.checkout.expiresIn}{' '}
              <span className="font-mono font-medium tabular-nums text-neutral-950">
                {formatCountdown(remainingMs)}
              </span>
            </p>
          )}
        </div>

        {/*
          Đang trả tiền cho CÁI GÌ. Trước đây trang này chỉ có mã đơn và số tiền,
          nên khách bấm nhầm sản phẩm cũng không có cách nào nhận ra trước khi trả.
        */}
        <ul className="space-y-2 border-t border-neutral-100 pt-4 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium text-neutral-950">{item.productName}</span>
                {item.variantName && (
                  <span className="text-neutral-500"> · {item.variantName}</span>
                )}
                <span className="block text-xs text-neutral-500">
                  {formatUsdt(item.unitPrice)} × {item.quantity}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-neutral-950">
                {formatUsdt(item.unitPrice * item.quantity)}
              </span>
            </li>
          ))}
        </ul>

        {methods !== null && methods.length > 1 && (
          <div className="space-y-2">
            <p className="text-center text-xs font-medium uppercase tracking-wide text-neutral-500">
              {t.checkout.methodTitle}
            </p>
            <div className="flex justify-center">
              <Tabs
                items={methods.map((m) => ({
                  value: m.method,
                  label: t.checkout.methods[m.method],
                }))}
                value={selectedMethod ?? methods[0].method}
                onChange={(method) => void handleSelectMethod(method)}
              />
            </div>
            {switchError && <p className="text-center text-sm text-red-600">{switchError}</p>}
          </div>
        )}

        <div className={cn(switching && 'pointer-events-none opacity-50')}>
          {switching && (
            <div className="mb-3 flex justify-center">
              <Spinner className="h-5 w-5 text-neutral-400" />
            </div>
          )}

          {payment?.mode === 'MOCK' ? (
            <div className="space-y-3 rounded-lg border border-dashed border-neutral-300 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FlaskConical className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {t.checkout.mockBadge}
              </p>
              <p className="text-sm text-neutral-500">{t.checkout.mockDescription}</p>
              <Link href={mockPayUrl} className={buttonVariants({ className: 'w-full' })}>
                {t.checkout.openMock}
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            </div>
          ) : payment?.mode === 'CRYPTO' ? (
            <div className="space-y-4 rounded-lg border border-neutral-200 p-4">
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
                {payment.cryptoQr && (
                  <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-white p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={payment.cryptoQr}
                      alt={t.checkout.cryptoQrAlt}
                      className="h-40 w-40"
                    />
                    {/*
                      Nói thẳng là mã CHỈ chứa địa chỉ. Quét xong tưởng đã xong
                      rồi gửi tròn số là tiền vào ví mà đơn không khớp được —
                      lúc đó phải nhờ admin đối soát tay.
                    */}
                    <p className="text-center text-xs text-neutral-500">
                      {t.checkout.cryptoQrHint}
                    </p>
                  </div>
                )}
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
                className="space-y-2 border-t border-neutral-100 pt-3"
              >
                <Label htmlFor="crypto-txid">{t.checkout.cryptoTxIdLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="crypto-txid"
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
          ) : (
            <div className="space-y-3 text-center">
              {payment?.qrcodeLink && (
                <div className="mx-auto w-fit rounded-xl border border-neutral-200 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={payment.qrcodeLink}
                    alt={t.checkout.qrAlt(order.code)}
                    className="h-44 w-44"
                  />
                </div>
              )}
              <p className="text-sm text-neutral-500">{t.checkout.scanQr}</p>
              {payment?.checkoutUrl && (
                <a
                  href={payment.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ className: 'w-full' })}
                >
                  {t.checkout.openBinance}
                  <ExternalLink className="h-4 w-4" strokeWidth={1.75} />
                </a>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-center text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neutral-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-neutral-500" />
          </span>
          {t.checkout.autoChecking}
        </div>

        <div className="flex gap-2 border-t border-neutral-100 pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            loading={checking}
            onClick={() => void checkPayment(true)}
          >
            {!checking && <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
            {t.checkout.checkNow}
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="flex-1"
            loading={cancelling}
            onClick={() => void handleCancel()}
          >
            {t.checkout.cancelOrder}
          </Button>
        </div>

        {/*
          Điều khoản đặt ở ĐÂY, ngay trước lúc trả tiền — chỗ duy nhất mà việc
          đồng ý có ý nghĩa. Bán sản phẩm số thì tranh chấp "key không dùng được"
          là chuyện thường ngày, và khi đó mọi bên cần quy về một văn bản.
        */}
        <p className="border-t border-neutral-100 pt-3 text-center text-xs leading-relaxed text-neutral-500">
          {t.checkout.legalNotice}{' '}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-neutral-950">
            {t.legal.termsTitle}
          </Link>
          {' · '}
          <Link href="/legal/refund" className="underline underline-offset-2 hover:text-neutral-950">
            {t.legal.refundTitle}
          </Link>
          {' · '}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-neutral-950">
            {t.legal.privacyTitle}
          </Link>
        </p>
      </Card>
    </div>
  );
}
