'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  PackageCheck,
  SearchX,
  ServerCrash,
  TriangleAlert,
} from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  formatVnd,
  vietQrBankName,
  type AdminOrderDetailDto,
  type OrderItemDto,
  type PaymentInfoDto,
} from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { formatCryptoAmount } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { PAYMENT_STATUS_BADGE_VARIANT } from '@/components/admin/helpers';

/** Admin order detail — API kèm email + mã khách hàng. */
type AdminOrderDetail = AdminOrderDetailDto;
type AdminPaymentInfo = PaymentInfoDto;

function deliveredCount(item: OrderItemDto): number {
  return item.deliveredLines?.length ?? 0;
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd
        className={
          mono
            ? 'break-all text-right font-mono text-[13px] text-neutral-950'
            : 'text-right text-neutral-950'
        }
      >
        {value}
      </dd>
    </div>
  );
}

export default function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  const loadOrder = useCallback(async (): Promise<AdminOrderDetail> => {
    return apiFetch<AdminOrderDetail>(`/admin/orders/${code}`, { token });
  }, [code, token]);

  useEffect(() => {
    let active = true;
    loadOrder()
      .then((data) => {
        if (active) setOrder(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [loadOrder, t]);

  const handleRedeliver = async () => {
    if (delivering) return;
    setDelivering(true);
    setDeliverError(null);
    try {
      await apiFetch<unknown>(`/admin/orders/${code}/deliver`, { method: 'POST', token });
      const refreshed = await loadOrder();
      setOrder(refreshed);
    } catch (err) {
      setDeliverError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setDelivering(false);
    }
  };

  /**
   * Xác nhận đã nhận tiền ngoài hệ thống (chuyển khoản ngân hàng, hoặc khách
   * nạp USDT mà bộ đối soát tự động không khớp được). Ghi chú đi vào nhật ký để
   * sau này còn truy được vì sao đơn này được duyệt tay.
   */
  const handleMarkPaid = async () => {
    if (markingPaid) return;
    const note = window.prompt(t.admin.markPaidPrompt, '');
    if (note === null) return;
    setMarkingPaid(true);
    setMarkPaidError(null);
    try {
      const updated = await apiFetch<AdminOrderDetail>(
        `/admin/orders/${code}/mark-paid`,
        { method: 'POST', body: { note: note.trim() }, token },
      );
      setOrder(updated);
    } catch (err) {
      setMarkPaidError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleCancel = async () => {
    if (cancelling) return;
    if (!window.confirm(t.admin.cancelOrderConfirm(code))) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const cancelled = await apiFetch<AdminOrderDetail>(`/admin/orders/${code}/cancel`, {
        method: 'POST',
        token,
      });
      setOrder(cancelled);
    } catch (err) {
      setCancelError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setCancelling(false);
    }
  };

  if (notFound) {
    return (
      <EmptyState
        icon={SearchX}
        title={t.admin.orderNotFoundTitle}
        hint={t.admin.orderNotFoundHint(code)}
        action={
          <Link href="/admin/orders" className={buttonVariants({ variant: 'outline' })}>
            {t.admin.backToOrders}
          </Link>
        }
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={ServerCrash}
        title={t.admin.orderLoadError}
        hint={error}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (order === null) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  const payment = order.payment as AdminPaymentInfo | null;
  const missingTotal = order.items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity - deliveredCount(item)),
    0,
  );
  const needsRedelivery = order.status === 'PAID' && missingTotal > 0;

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-950"
      >
        <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
        {t.admin.navOrders}
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-neutral-950">
            {order.code}
          </h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Đơn chờ hoặc đã hết hạn vẫn xác nhận tay được: khách chuyển khoản
              ngân hàng, hoặc nạp USDT mà bộ đối soát không khớp. */}
          {(order.status === 'PENDING' || order.status === 'EXPIRED') && (
            <Button
              size="sm"
              loading={markingPaid}
              onClick={() => void handleMarkPaid()}
            >
              {!markingPaid && (
                <BadgeCheck strokeWidth={1.75} className="h-4 w-4" />
              )}
              {t.admin.markPaidAction}
            </Button>
          )}
          {order.status === 'PENDING' && (
            <Button
              variant="danger"
              size="sm"
              loading={cancelling}
              onClick={() => void handleCancel()}
            >
              {!cancelling && <Ban strokeWidth={1.75} className="h-4 w-4" />}
              {t.admin.cancelOrder}
            </Button>
          )}
          <p className="text-xl font-semibold tabular-nums tracking-tight">
            {formatUsdt(order.totalAmount)}
          </p>
        </div>
      </div>

      {cancelError && <p className="mb-4 text-sm text-red-600">{cancelError}</p>}
      {markPaidError && (
        <p className="mb-4 text-sm text-red-600">{markPaidError}</p>
      )}

      {needsRedelivery && (
        <Card className="mb-6 border-neutral-300 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
              <TriangleAlert strokeWidth={1.75} className="h-4.5 w-4.5 text-neutral-600" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-neutral-950">
                {t.admin.redeliverTitle(missingTotal)}
              </p>
              <p className="mt-0.5 text-sm text-neutral-500">{t.admin.redeliverHint}</p>
            </div>
            <Button loading={delivering} onClick={() => void handleRedeliver()}>
              {!delivering && <PackageCheck strokeWidth={1.75} className="h-4 w-4" />}
              {t.admin.redeliverAction}
            </Button>
          </div>
          {deliverError && <p className="mt-3 text-sm text-red-600">{deliverError}</p>}
        </Card>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_360px]">
        {/* Items + delivered lines */}
        <Card className="divide-y divide-neutral-100 p-6">
          <h2 className="pb-4 text-lg font-semibold tracking-tight text-neutral-950">
            {t.admin.itemsTitle(order.items.length)}
          </h2>
          {order.items.map((item) => {
            const delivered = deliveredCount(item);
            const missing = Math.max(0, item.quantity - delivered);
            return (
              <div key={item.id} className="py-4 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-neutral-950">
                    {item.variantName
                      ? t.admin.productVariantLabel(item.productName, item.variantName)
                      : item.productName}
                  </p>
                  <p className="text-sm text-neutral-500 tabular-nums">
                    {formatUsdt(item.unitPrice)} × {item.quantity} ={' '}
                    <span className="font-semibold text-neutral-950">
                      {formatUsdt(item.unitPrice * item.quantity)}
                    </span>
                  </p>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {t.admin.deliveredLines(delivered, item.quantity)}
                  </p>
                  {delivered > 0 ? (
                    <ul className="mt-2 divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-neutral-50">
                      {(item.deliveredLines ?? []).map((line, index) => (
                        <li
                          key={`${item.id}-${index}`}
                          className="break-all px-3 py-2 font-mono text-[13px] text-neutral-950"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-neutral-400">{t.admin.noDeliveredLines}</p>
                  )}
                  {missing > 0 && order.status === 'PAID' && (
                    <p className="mt-2 text-sm text-neutral-500">
                      {t.admin.missingLines(missing)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        <div className="space-y-4">
          {/* Order info */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
              {t.admin.orderInfoTitle}
            </h2>
            <dl className="mt-3 divide-y divide-neutral-100 text-sm">
              <InfoRow label={t.admin.infoCode} value={order.code} mono />
              <InfoRow label={t.admin.infoCustomer} value={order.userEmail} />
              <InfoRow
                label={t.admin.infoCustomerCode}
                value={
                  <Link
                    href={`/admin/customers/${order.userId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {formatUserCode(order.userCode)}
                  </Link>
                }
                mono
              />
              <InfoRow label={t.admin.infoCreatedAt} value={formatDate(order.createdAt)} />
              <InfoRow label={t.admin.infoPaidAt} value={formatDate(order.paidAt)} />
              {order.status === 'PENDING' && (
                <InfoRow label={t.admin.infoExpiresAt} value={formatDate(order.expiresAt)} />
              )}
              <InfoRow label={t.admin.infoTotal} value={formatUsdt(order.totalAmount)} />
            </dl>
          </Card>

          {/* Payment info */}
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                {t.admin.paymentTitle}
              </h2>
              {payment && (
                <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[payment.status]}>
                  {t.paymentStatus[payment.status]}
                </Badge>
              )}
            </div>
            {payment ? (
              <dl className="mt-3 divide-y divide-neutral-100 text-sm">
                <InfoRow label={t.admin.infoGateway} value={t.paymentMode[payment.mode]} />
                <InfoRow
                  label={t.admin.infoTradeNo}
                  value={payment.merchantTradeNo ?? t.common.dash}
                  mono
                />
                {payment.mode === 'BANK' ? (
                  <>
                    <InfoRow
                      label={t.admin.infoBankAccount}
                      value={
                        payment.bankAccountNumber
                          ? `${vietQrBankName(payment.bankBin ?? '')} · ${payment.bankAccountNumber}`
                          : t.common.dash
                      }
                      mono
                    />
                    <InfoRow
                      label={t.admin.infoBankAmount}
                      value={
                        payment.bankAmountVnd !== undefined
                          ? formatVnd(payment.bankAmountVnd)
                          : t.common.dash
                      }
                      mono
                    />
                    {/* Nội dung chuyển khoản là thứ DUY NHẤT để dò ra đơn này
                        trong sao kê ngân hàng. */}
                    <InfoRow
                      label={t.admin.infoBankContent}
                      value={payment.bankTransferContent ?? t.common.dash}
                      mono
                    />
                    <InfoRow
                      label={t.admin.infoBankClaimed}
                      value={
                        payment.customerClaimedAt
                          ? formatDate(payment.customerClaimedAt)
                          : t.admin.infoBankNotClaimed
                      }
                    />
                  </>
                ) : payment.mode === 'CRYPTO' ? (
                  <>
                    <InfoRow
                      label={t.admin.infoCryptoNetwork}
                      value={payment.cryptoNetwork ?? t.common.dash}
                    />
                    <InfoRow
                      label={t.admin.infoCryptoAddress}
                      value={payment.cryptoAddress ?? t.common.dash}
                      mono
                    />
                    <InfoRow
                      label={t.admin.infoCryptoAmount}
                      value={
                        payment.cryptoAmount !== undefined
                          ? `${formatCryptoAmount(payment.cryptoAmount)} USDT`
                          : t.common.dash
                      }
                      mono
                    />
                    <InfoRow
                      label={t.admin.infoCryptoTxId}
                      value={payment.cryptoTxId ?? t.common.dash}
                      mono
                    />
                  </>
                ) : (
                  <InfoRow
                    label={t.admin.infoPrepayId}
                    value={payment.prepayId ?? t.common.dash}
                    mono
                  />
                )}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-neutral-400">{t.admin.noPayment}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
