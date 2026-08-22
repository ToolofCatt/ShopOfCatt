'use client';

import { AtSign, Coins, FlaskConical, Landmark, Wallet, type LucideIcon } from 'lucide-react';
import type { PaymentMethod } from '@webcatt/shared';

import { cn } from '@/lib/cn';

/**
 * Chọn phương thức thanh toán ở trang thanh toán.
 *
 * Có riêng component này thay vì dùng `Tabs` chung của trang quản trị vì hai lý do:
 *
 * 1. `Tabs` dùng `flex-wrap`, mà nhãn ở đây dài ("Chuyển khoản ngân hàng") nên bật
 *    đủ bốn phương thức là xuống hai hàng, đẩy mã QR ra khỏi khung hình. Lưới chia
 *    đều `1fr` không bao giờ xuống hàng, dù bật bao nhiêu phương thức.
 * 2. Mỗi phương thức có một biểu tượng — khách nhận ra "ngân hàng" hay "ví" nhanh
 *    hơn đọc chữ, và biểu tượng cho phép rút nhãn xuống thật ngắn để vừa một hàng.
 */

const ICON: Record<PaymentMethod, LucideIcon> = {
  mock: FlaskConical,
  binance_pay: Wallet,
  binance_id: AtSign,
  crypto_bep20: Coins,
  crypto_trc20: Coins,
  sepay: Landmark,
};

export interface PaymentMethodTabsProps {
  methods: PaymentMethod[];
  value: PaymentMethod;
  labels: Record<PaymentMethod, string>;
  onChange: (method: PaymentMethod) => void;
  disabled?: boolean;
}

export function PaymentMethodTabs({
  methods,
  value,
  labels,
  onChange,
  disabled,
}: PaymentMethodTabsProps) {
  return (
    <div
      role="tablist"
      className="grid w-full gap-1 rounded-lg border border-neutral-200 bg-white p-1"
      // Số cột theo số phương thức đang bật — Tailwind không sinh sẵn class động.
      style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }}
    >
      {methods.map((method) => {
        const active = method === value;
        const Icon = ICON[method];
        return (
          <button
            key={method}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(method)}
            title={labels[method]}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-md px-1.5 py-2 text-[11px] font-medium leading-tight transition-colors disabled:cursor-default',
              active
                ? 'bg-neutral-950 text-white'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {/* Nhãn có thể dài hơn cột: cắt bằng "…", tên đầy đủ nằm ở `title`. */}
            <span className="w-full truncate text-center">{labels[method]}</span>
          </button>
        );
      })}
    </div>
  );
}
