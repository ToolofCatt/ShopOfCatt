'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  formatUsdt,
  formatUserCode,
  isAdminRole,
  sumMoney,
  type OrderSummaryDto,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Badge, Card, Spinner } from '@/components/ui';
import { StatCard } from '@/components/admin/stat-card';

/* ---------- clipboard helper (Copy → Check swap, 1.5s) ---------- */

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

function CopyCodeButton({ text }: { text: string }) {
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
      aria-label={t.account.copyCode}
      className={cn(
        'shrink-0 cursor-pointer rounded-md p-1.5 transition-colors',
        copied
          ? 'text-emerald-600'
          : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950',
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

/* ---------- quick link row ---------- */

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-50"
    >
      <Icon className="h-4 w-4 text-neutral-500" strokeWidth={1.75} />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-neutral-400" strokeWidth={1.75} />
    </Link>
  );
}

/* ---------- page ---------- */

export default function AccountPage() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const { t, formatDate } = useI18n();

  const [orders, setOrders] = useState<OrderSummaryDto[] | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Trang yêu cầu đăng nhập — giống trang /orders.
  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      router.replace(`/login?next=${encodeURIComponent('/account')}`);
      return;
    }
    let active = true;
    apiFetch<OrderSummaryDto[]>('/orders', { token })
      .then((data) => {
        if (active) setOrders(data);
      })
      .catch((err: unknown) => {
        if (active) setStatsError(apiErrorMessage(err, t.account.statsError));
      });
    return () => {
      active = false;
    };
  }, [authLoading, token, router, t]);

  if (authLoading || !user) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  const completed = orders?.filter(
    (order) => order.status === 'PAID' || order.status === 'DELIVERED',
  );
  const totalSpent = completed && sumMoney(completed.map((o) => o.totalAmount));

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t.account.title}</h1>
      <p className="mt-1 text-sm text-neutral-500">{t.account.subtitle}</p>

      {/* Thẻ hồ sơ */}
      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
            <UserRound className="h-7 w-7 text-neutral-600" strokeWidth={1.75} />
          </span>
          <dl className="grid flex-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-neutral-500">{t.auth.emailLabel}</dt>
              <dd className="mt-0.5 break-all font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">{t.nav.customerCode}</dt>
              <dd className="mt-0.5 flex items-center gap-1">
                <span className="font-mono font-medium tabular-nums">
                  {formatUserCode(user.code)}
                </span>
                <CopyCodeButton text={formatUserCode(user.code)} />
              </dd>
            </div>
            {isAdminRole(user.role) && (
              <div>
                <dt className="text-neutral-500">{t.account.roleLabel}</dt>
                <dd className="mt-1">
                  <Badge variant={user.role === 'SUPERADMIN' ? 'solid' : 'outline'}>
                    {user.role === 'SUPERADMIN' ? t.account.roleSuperadmin : t.account.roleAdmin}
                  </Badge>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-neutral-500">{t.account.memberSince}</dt>
              <dd className="mt-0.5 font-medium">{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Hàng thống kê — tính phía client từ GET /orders */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={ReceiptText}
          label={t.account.statOrders}
          value={orders ? String(orders.length) : t.common.dash}
        />
        <StatCard
          icon={CheckCircle2}
          label={t.account.statCompleted}
          value={completed ? String(completed.length) : t.common.dash}
        />
        <StatCard
          icon={Wallet}
          label={t.account.statSpent}
          value={totalSpent !== undefined ? formatUsdt(totalSpent) : t.common.dash}
        />
      </div>
      {statsError && <p className="mt-2 text-sm text-red-600">{statsError}</p>}

      {/* Liên kết nhanh */}
      <h2 className="mt-8 font-semibold tracking-tight">{t.account.quickLinks}</h2>
      <Card className="mt-3 divide-y divide-neutral-100 overflow-hidden">
        <QuickLink href="/orders" icon={ReceiptText} label={t.nav.myOrders} />
        <QuickLink href="/account/password" icon={KeyRound} label={t.nav.changePassword} />
        {isAdminRole(user.role) && (
          <QuickLink href="/admin" icon={LayoutDashboard} label={t.nav.adminPanel} />
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
          {t.nav.logout}
        </button>
      </Card>
    </div>
  );
}
