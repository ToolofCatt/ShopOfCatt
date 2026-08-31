'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus, Ticket, Wallet, Zap } from 'lucide-react';
import {
  cheapestAnchored,
  roundUsdt,
  type CouponPreviewDto,
  type CreateOrderResponse,
  type PaymentMethod,
  type PaymentMethodDto,
  type ProductDto,
  type ProductVariantDto,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePrices } from '@/lib/prices';
import { useI18n } from '@/lib/i18n/client';
import { Badge, Button, Card, Input, Label } from '@/components/ui';
import { VariantSelector } from '@/components/variant-selector';
import { PaymentMethodTabs } from '@/components/payment-method-tabs';

export function BuyBox({ product }: { product: ProductDto }) {
  const router = useRouter();
  const { user, token, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const { price, priceUsdt } = usePrices();

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
  const maxQuantity = Math.max(1, availableStock);

  /*
    Loại đang chọn thì hiện theo NEO của chính nó (số tròn); chưa chọn thì lấy
    neo của loại rẻ nhất, để con số trên thẻ sản phẩm và ở đây khớp nhau.
  */
  const neoReNhat = cheapestAnchored(product.variants);
  const giaChinh = selected
    ? price(selected)
    : neoReNhat
      ? price(neoReNhat)
      : priceUsdt(product.minPrice);
  const priceLabel = selected
    ? giaChinh.primary
    : product.maxPrice > product.minPrice
      ? t.product.priceFrom(giaChinh.primary)
      : giaChinh.primary;

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

  /** Tên các phương thức, gộp BEP20/TRC20 thành một nhãn "USDT (BEP20, TRC20)". */
  const paymentLabels = useMemo(() => {
    if (!methods || methods.length === 0) return [];
    const parts: string[] = [];
    if (methods.includes('binance_pay')) parts.push(t.product.payBinancePay);
    if (methods.includes('binance_id')) parts.push(t.product.payBinanceId);
    if (methods.includes('sepay')) parts.push(t.product.paySepay);
    const networks = [
      methods.includes('crypto_bep20') ? 'BEP20' : null,
      methods.includes('crypto_trc20') ? 'TRC20' : null,
    ].filter(Boolean);
    if (networks.length > 0) parts.push(t.product.payCrypto(networks.join(', ')));
    if (methods.includes('mock')) parts.push(t.product.payMock);
    return parts;
  }, [methods, t.product]);

  /** Chưa bật phương thức nào → đặt hàng chắc chắn lỗi 503, chặn ngay tại đây. */
  const noPaymentMethod = methods !== null && methods.length === 0;

  /*
   * Khách chọn phương thức NGAY Ở ĐÂY, cùng lúc chọn số lượng.
   *
   * Trước đây phải đặt đơn xong, sang trang thanh toán mới thấy có những cách
   * nào — biết mình không trả được bằng cách nào thì đã giữ mất hàng và phải
   * huỷ đơn.
   */
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  useEffect(() => {
    if (methods && methods.length > 0) setPayMethod((cur) => cur ?? methods[0]);
  }, [methods]);

  // Mã giảm giá: giữ mã đã áp dụng, số tiền giảm luôn do máy chủ tính lại
  // mỗi khi đổi loại hoặc số lượng — không tự tính ở trình duyệt.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<CouponPreviewDto | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  /*
    Làm tròn SÁU chữ số, không phải hai.

    Hai chữ số phá giá neo theo ₫: đơn giá 3.852198 USDT (= 100.000 ₫) thành 3.85
    rồi quy sang ₫ ra 99.943 — đúng lỗi đã thấy trên trang chi tiết, đơn giá ghi
    100.000 ₫ mà dòng "Tổng cộng" ghi 99.943 ₫. Làm tròn ở đây chỉ để dập rác nhị
    phân của phép nhân số thực, còn máy chủ tính bằng Decimal nên vốn đã chính xác.
  */
  const subtotal = roundUsdt(unitPrice * quantity);
  const discount = coupon ? coupon.discountAmount : 0;
  const payable = Math.max(0, roundUsdt(subtotal - discount));

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
      /*
       * Chốt phương thức ngay, trước khi chuyển trang. Lỗi ở bước này KHÔNG
       * chặn: đơn đã tạo và trang thanh toán vẫn cho chọn lại, chặn ở đây chỉ
       * làm khách mắc kẹt với một đơn đang giữ hàng.
       */
      if (payMethod) {
        try {
          await apiFetch(`/orders/${response.order.code}/select-payment`, {
            method: 'POST',
            body: { method: payMethod },
            token,
          });
        } catch {
          // để trang thanh toán xử lý
        }
      }
      router.push(`/checkout/${response.order.code}`);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  return (
    <Card className="space-y-6 rounded-lg border-neutral-300 p-5 shadow-[0_12px_30px_rgba(0,0,0,0.08)] sm:p-6">
      {/*
        Tổng đã bán nằm cạnh tiêu đề sản phẩm; hộp mua chỉ nêu trạng thái của
        loại đang chọn để khách không hiểu nhầm tổng kho là kho của một loại.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-3xl font-semibold tabular-nums text-neutral-950">{priceLabel}</p>
        <Badge variant={outOfStock ? 'muted' : 'success'} className="mt-1">
          {outOfStock ? t.product.outOfStock : t.product.inStockShort(availableStock)}
        </Badge>
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

          <div className="space-y-1 border-t border-neutral-200 pt-4">
            {coupon && (
              <>
                <div className="flex items-center justify-between text-sm text-neutral-500">
                  <span>{t.product.subtotal}</span>
                  <span className="tabular-nums">{priceUsdt(subtotal).primary}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-neutral-600">
                  <span>{t.product.discount}</span>
                  <span className="tabular-nums">−{priceUsdt(discount).primary}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">{t.product.total}</span>
              <span className="text-lg font-semibold tabular-nums">
                {priceUsdt(payable).primary}
              </span>
            </div>
          </div>
        </>
      )}

      <div className="space-y-2">
        <Button
          className="h-12 w-full text-base"
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

      {/*
        Nhiều phương thức thì cho chọn hẳn; chỉ một thì nêu tên cho khách biết
        mình sẽ trả bằng gì, không cần bắt chọn giữa một lựa chọn. Khi hết hàng
        vẫn giữ các nhãn để khách biết cửa hàng hỗ trợ cách thanh toán nào.
      */}
      {methods && methods.length > 1 && !outOfStock ? (
        <div className="space-y-2 border-t border-neutral-200 pt-4">
          <Label htmlFor="pay-method">{t.checkout.methodTitle}</Label>
          <PaymentMethodTabs
            methods={methods}
            labels={t.checkout.methodsShort}
            value={payMethod ?? methods[0]}
            onChange={setPayMethod}
          />
        </div>
      ) : (
        paymentLabels.length > 0 && (
          <div className="space-y-2.5 border-t border-neutral-200 pt-4">
            <p className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <Wallet className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {t.checkout.methodTitle}
            </p>
            <div className="flex flex-wrap gap-2">
              {paymentLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium text-neutral-600"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )
      )}
    </Card>
  );
}
