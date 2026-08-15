'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, ShieldCheck, Ticket, Wallet, Zap } from 'lucide-react';
import {
  formatUsdt,
  type CouponPreviewDto,
  type CreateOrderResponse,
  type PaymentMethod,
  type PaymentMethodDto,
  type ProductDto,
  type ProductVariantDto,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, Input, Label } from '@/components/ui';
import { VariantSelector } from '@/components/variant-selector';

export function BuyBox({ product }: { product: ProductDto }) {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const { t } = useI18n();

  // API công khai chỉ trả loại đang bán, vẫn lọc lại cho chắc.
  const variants = useMemo(
    () => product.variants.filter((variant) => variant.active),
    [product.variants],
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    () => (variants.find((variant) => variant.availableStock > 0) ?? variants[0])?.id ?? null,
  );

  // Loại đang chọn — tự lùi về loại còn hàng đầu tiên nếu id không còn hợp lệ.
  const selected =
    variants.find((variant) => variant.id === selectedId) ??
    variants.find((variant) => variant.availableStock > 0) ??
    variants[0] ??
    null;

  const outOfStock = variants.every((variant) => variant.availableStock <= 0);
  const unitPrice = selected ? selected.price : product.minPrice;
  const availableStock = selected ? selected.availableStock : product.availableStock;
  const sold = selected ? selected.sold : product.sold;
  const maxQuantity = Math.max(1, availableStock);

  const priceLabel = selected
    ? formatUsdt(selected.price)
    : product.maxPrice > product.minPrice
      ? t.product.priceFrom(formatUsdt(product.minPrice))
      : formatUsdt(product.minPrice);

  const [quantity, setQuantity] = useState(1);
  const [inputValue, setInputValue] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Phương thức thanh toán ĐANG BẬT, đọc từ API công khai.
   *
   * Trước đây dòng dưới nút mua ghi cứng "Binance Pay — USDT" bất kể cửa hàng bật
   * gì: bật mỗi USDT on-chain thì khách vẫn đọc thấy Binance Pay, mà bật cổng giả
   * lập thì trang hứa một cổng thật không tồn tại. Hứa sai ở đúng chỗ khách quyết
   * định trả tiền là mất niềm tin.
   *
   * `null` = đang tải; `[]` = cửa hàng chưa bật phương thức nào.
   */
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<PaymentMethodDto[]>('/payment-methods')
      .then((list) => {
        if (active) setMethods(list.map((entry) => entry.method));
      })
      .catch(() => {
        // Không đọc được thì im lặng: chỉ ẩn dòng gợi ý, không chặn việc mua.
        if (active) setMethods(null);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Tên các phương thức, gộp BEP20/TRC20 thành một dòng "USDT (BEP20, TRC20)". */
  const paymentLabel = useMemo(() => {
    if (!methods || methods.length === 0) return null;
    const parts: string[] = [];
    if (methods.includes('binance_pay')) parts.push(t.product.payBinancePay);
    const networks = [
      methods.includes('crypto_bep20') ? 'BEP20' : null,
      methods.includes('crypto_trc20') ? 'TRC20' : null,
    ].filter(Boolean);
    if (networks.length > 0) parts.push(t.product.payCrypto(networks.join(', ')));
    if (methods.includes('mock')) parts.push(t.product.payMock);
    return parts.join(' · ');
  }, [methods, t.product]);

  /** Chưa bật phương thức nào → đặt hàng chắc chắn lỗi 503, chặn ngay tại đây. */
  const noPaymentMethod = methods !== null && methods.length === 0;

  // Mã giảm giá: giữ mã đã áp dụng, số tiền giảm luôn do máy chủ tính lại
  // mỗi khi đổi loại hoặc số lượng — không tự tính ở trình duyệt.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<CouponPreviewDto | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const subtotal = unitPrice * quantity;
  const discount = coupon ? coupon.discountAmount : 0;
  const payable = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  const clearCoupon = () => {
    setAppliedCode(null);
    setCoupon(null);
    setCouponError(null);
    setCouponInput('');
  };

  const checkCoupon = useCallback(
    async (code: string, silent: boolean) => {
      if (!selected || !token) return;
      if (!silent) setCheckingCoupon(true);
      try {
        const preview = await apiFetch<CouponPreviewDto>('/coupons/preview', {
          method: 'POST',
          body: { code, items: [{ variantId: selected.id, quantity }] },
          token,
        });
        setCoupon(preview);
        setAppliedCode(preview.code);
        setCouponError(null);
      } catch (err) {
        setCoupon(null);
        setAppliedCode(null);
        setCouponError(apiErrorMessage(err, t.common.connectionError));
      } finally {
        if (!silent) setCheckingCoupon(false);
      }
    },
    [selected, token, quantity, t],
  );

  // Đổi loại/số lượng → tính lại số tiền giảm cho đúng đơn hiện tại.
  useEffect(() => {
    if (appliedCode) void checkCoupon(appliedCode, true);
    // checkCoupon đã phụ thuộc selected.id + quantity
  }, [appliedCode, checkCoupon]);

  const handleApplyCoupon = () => {
    const code = couponInput.trim();
    if (!code || checkingCoupon) return;
    if (!user || !token) {
      router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    void checkCoupon(code, false);
  };

  const clamp = (value: number) => Math.min(Math.max(1, value), maxQuantity);

  const applyQuantity = (value: number) => {
    const next = clamp(value);
    setQuantity(next);
    setInputValue(String(next));
  };

  const handleInputChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setInputValue(digits);
    if (digits) setQuantity(clamp(Number.parseInt(digits, 10)));
  };

  // Đổi loại → giữ số lượng trong giới hạn kho của loại mới.
  const handleSelectVariant = (variant: ProductVariantDto) => {
    setSelectedId(variant.id);
    setError(null);
    const next = Math.min(Math.max(1, quantity), Math.max(1, variant.availableStock));
    setQuantity(next);
    setInputValue(String(next));
  };

  const handleBuy = async () => {
    if (authLoading || submitting || outOfStock || !selected) return;
    if (!user || !token) {
      router.push(`/login?next=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch<CreateOrderResponse>('/orders', {
        method: 'POST',
        body: {
          items: [{ variantId: selected.id, quantity }],
          ...(appliedCode ? { couponCode: appliedCode } : {}),
        },
        token,
      });
      router.push(`/checkout/${response.order.code}`);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-5 p-5 shadow-sm">
      <div>
        <p className="text-3xl font-semibold tabular-nums tracking-tight">{priceLabel}</p>
        <p className="mt-1 text-sm text-neutral-500">
          {availableStock <= 0 ? t.product.outOfStock : t.product.inStockLong(availableStock)}
          {sold > 0 && <> · {t.product.sold(sold)}</>}
        </p>
      </div>

      {variants.length > 1 && (
        <VariantSelector
          variants={variants}
          selectedId={selected?.id ?? null}
          onSelect={handleSelectVariant}
        />
      )}

      {!outOfStock && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="buy-quantity">{t.product.quantity}</Label>
            <div className="flex w-fit items-stretch overflow-hidden rounded-lg border border-neutral-300">
              <button
                type="button"
                aria-label={t.product.decrease}
                onClick={() => applyQuantity(quantity - 1)}
                disabled={quantity <= 1}
                className="flex h-10 w-10 cursor-pointer items-center justify-center text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Minus className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <input
                id="buy-quantity"
                inputMode="numeric"
                value={inputValue}
                onChange={(event) => handleInputChange(event.target.value)}
                onBlur={() => applyQuantity(quantity)}
                className="w-14 border-x border-neutral-300 text-center text-sm font-medium tabular-nums outline-none"
                aria-label={t.product.quantity}
              />
              <button
                type="button"
                aria-label={t.product.increase}
                onClick={() => applyQuantity(quantity + 1)}
                disabled={quantity >= maxQuantity}
                className="flex h-10 w-10 cursor-pointer items-center justify-center text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <p className="text-xs text-neutral-500">{t.product.max(availableStock)}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coupon-code">{t.product.couponLabel}</Label>
            <div className="flex gap-2">
              <Input
                id="coupon-code"
                autoComplete="off"
                className="flex-1 font-mono uppercase"
                placeholder={t.product.couponPlaceholder}
                invalid={Boolean(couponError)}
                disabled={coupon !== null}
                value={couponInput}
                onChange={(event) => {
                  setCouponInput(event.target.value.toUpperCase());
                  setCouponError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleApplyCoupon();
                  }
                }}
              />
              {coupon ? (
                <Button type="button" variant="outline" onClick={clearCoupon}>
                  {t.product.couponRemove}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  loading={checkingCoupon}
                  onClick={handleApplyCoupon}
                >
                  {t.product.couponApply}
                </Button>
              )}
            </div>
            {couponError && <p className="text-sm text-red-600">{couponError}</p>}
            {coupon && (
              <p className="flex items-center gap-1.5 text-sm text-neutral-600">
                <Ticket className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {t.product.couponApplied(coupon.code)}
              </p>
            )}
          </div>

          <div className="space-y-1 border-t border-neutral-100 pt-4">
            {coupon && (
              <>
                <div className="flex items-center justify-between text-sm text-neutral-500">
                  <span>{t.product.subtotal}</span>
                  <span className="tabular-nums">{formatUsdt(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-neutral-600">
                  <span>{t.product.discount}</span>
                  <span className="tabular-nums">−{formatUsdt(discount)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">{t.product.total}</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatUsdt(payable)}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Button
          className="w-full"
          loading={submitting}
          disabled={outOfStock || noPaymentMethod}
          onClick={() => void handleBuy()}
        >
          {outOfStock ? (
            t.product.outOfStock
          ) : (
            <>
              <Zap className="h-4 w-4" strokeWidth={1.75} />
              {t.product.buyNow}
            </>
          )}
        </Button>
        {noPaymentMethod && !outOfStock && (
          <p className="text-sm text-neutral-500">{t.product.noPaymentMethod}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="space-y-2 border-t border-neutral-100 pt-4 text-sm text-neutral-500">
        <p className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t.product.reassureAuto}
        </p>
        {paymentLabel && (
          <p className="flex items-center gap-2">
            <Wallet className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {paymentLabel}
          </p>
        )}
      </div>
    </Card>
  );
}
