'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { formatUsdt, type OrderDetailDto, type OrderStatus } from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Spinner } from '@/components/ui';
import { Wordmark } from '@/components/wordmark';

export default function MockPayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { token, loading: authLoading } = useAuth();
  const { t } = useI18n();

  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent(`/mock-pay/${code}`)}`);
      return;
    }
    let active = true;
    apiFetch<OrderDetailDto>(`/orders/${code}`, { token })
      .then((data) => {
        if (active) setOrder(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? t.mockPay.notFound
            : apiErrorMessage(err, t.common.connectionError),
        );
      });
    return () => {
      active = false;
    };
  }, [authLoading, token, code, router, t]);

  useEffect(() => {
    if (!success) return;
    const id = window.setTimeout(() => router.push(`/orders/${code}?paid=1`), 1500);
    return () => window.clearTimeout(id);
  }, [success, code, router]);

  const handleConfirm = async () => {
    if (confirming || success) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      // Cần token: máy chủ chỉ cho khách xác nhận ĐƠN CỦA CHÍNH MÌNH.
      await apiFetch<{ status: OrderStatus }>('/payments/mock/confirm', {
        method: 'POST',
        body: { code },
        token,
      });
      setSuccess(true);
    } catch (err) {
      setConfirmError(apiErrorMessage(err, t.common.connectionError));
      setConfirming(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-neutral-100 px-4 py-16">
      <div className="w-full max-w-md rounded-2xl bg-neutral-950 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm font-semibold tracking-wide">Binance Pay</p>
          <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-[11px] uppercase tracking-wider text-neutral-400">
            {t.mockPay.sandbox}
          </span>
        </div>

        {success ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-14 w-14 text-emerald-500" strokeWidth={1.5} />
            <p className="text-lg font-semibold">{t.mockPay.successTitle}</p>
            <p className="flex items-center gap-2 text-sm text-neutral-400">
              <Spinner className="h-3.5 w-3.5" />
              {t.mockPay.redirecting}
            </p>
          </div>
        ) : loadError ? (
          <div className="mt-8 space-y-4 py-4 text-center">
            <ShieldAlert className="mx-auto h-10 w-10 text-neutral-500" strokeWidth={1.5} />
            <p className="text-sm text-red-400">{loadError}</p>
            <Link
              href="/orders"
              className="text-sm text-neutral-400 underline underline-offset-4 transition-colors hover:text-white"
            >
              {t.mockPay.backToOrders}
            </Link>
          </div>
        ) : !order ? (
          <div className="mt-8 flex justify-center py-10">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : order.status !== 'PENDING' ? (
          <div className="mt-8 space-y-4 py-4 text-center">
            <p className="text-sm text-neutral-400">{t.mockPay.notPending(order.code)}</p>
            <Link
              href={`/orders/${order.code}`}
              className="text-sm text-neutral-400 underline underline-offset-4 transition-colors hover:text-white"
            >
              {t.mockPay.viewOrder}
            </Link>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-wider text-neutral-500">
                {t.mockPay.amountLabel}
              </p>
              <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">
                {formatUsdt(order.totalAmount)}
              </p>
            </div>

            <dl className="space-y-2 rounded-xl bg-white/5 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-400">{t.mockPay.merchant}</dt>
                <dd>
                  <Wordmark size="sm" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-400">{t.mockPay.orderCode}</dt>
                <dd className="font-mono">{order.code}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-neutral-400">{t.mockPay.method}</dt>
                <dd>USDT</dd>
              </div>
            </dl>

            {confirmError && <p className="text-center text-sm text-red-400">{confirmError}</p>}

            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming}
              className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white font-medium text-neutral-950 transition-colors hover:bg-neutral-200 disabled:pointer-events-none disabled:opacity-60"
            >
              {confirming && <Spinner />}
              {t.mockPay.confirm}
            </button>

            <div className="text-center">
              <Link
                href={`/checkout/${code}`}
                className="text-sm text-neutral-400 underline underline-offset-4 transition-colors hover:text-white"
              >
                {t.mockPay.cancel}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
