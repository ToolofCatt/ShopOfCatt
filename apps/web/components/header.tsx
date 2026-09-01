'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import { formatUserCode, isAdminRole, type PublicUser } from '@webcatt/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Wordmark } from '@/components/wordmark';
import { useStorefront } from '@/lib/storefront';

export function Header() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const store = useStorefront();
  const logo = store.mediaUrl(store.document.brand.logoAssetId) ?? '/logo-mark.png';

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--store-border)] bg-[color-mix(in_srgb,var(--store-surface)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-16 items-center justify-between gap-4 px-4" style={{ maxWidth: 'var(--store-container)' }}>
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
          {/* Bọc bằng phần tử riêng: `Wordmark` tự có `inline-flex`, nên đặt
              `hidden` trực tiếp lên nó bị xung đột thứ tự CSS và vẫn hiện ở mobile. */}
          <span className="hidden sm:block">
            <Wordmark size="sm" />
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2">
          {user && (
            <Link
              href="/orders"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 sm:flex"
            >
              <ReceiptText className="h-4 w-4" strokeWidth={1.75} />
              {t.nav.orders}
            </Link>
          )}
          {user && isAdminRole(user.role) && (
            <Link
              href="/admin"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-950 sm:flex"
            >
              <LayoutDashboard className="h-4 w-4" strokeWidth={1.75} />
              {t.nav.admin}
            </Link>
          )}

          <LanguageSwitcher />

          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded-lg bg-neutral-100" aria-hidden="true" />
          ) : user ? (
            <UserMenu user={user} />
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t.nav.login}
              </Link>
              <Link href="/register" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
                {t.nav.register}
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

function UserMenu({ user }: { user: PublicUser }) {
  const { logout } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout();
    router.push('/');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.nav.account}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-2.5 text-sm text-neutral-950 transition-colors hover:border-neutral-400"
      >
        <UserRound className="h-4 w-4" strokeWidth={1.75} />
        <span className="hidden font-mono text-xs tabular-nums sm:inline">
          {formatUserCode(user.code)}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-neutral-400 transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-neutral-200 bg-white py-1.5 shadow-lg"
        >
          <div className="border-b border-neutral-100 px-3 pb-2 pt-1">
            <p className="truncate text-sm font-medium text-neutral-950">{user.email}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500">
              <span>{t.nav.customerCode}</span>
              <span className="font-mono font-medium tabular-nums text-neutral-950">
                {formatUserCode(user.code)}
              </span>
            </p>
          </div>
          <Link
            role="menuitem"
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-950"
          >
            <UserRound className="h-4 w-4" strokeWidth={1.75} />
            {t.nav.account}
          </Link>
          <Link
            role="menuitem"
            href="/orders"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-950"
          >
            <ReceiptText className="h-4 w-4" strokeWidth={1.75} />
            {t.nav.myOrders}
          </Link>
          {isAdminRole(user.role) && (
            <Link
              role="menuitem"
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-950"
            >
              <LayoutDashboard className="h-4 w-4" strokeWidth={1.75} />
              {t.nav.adminPanel}
            </Link>
          )}
          <Link
            role="menuitem"
            href="/account/password"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-950"
          >
            <KeyRound className="h-4 w-4" strokeWidth={1.75} />
            {t.nav.changePassword}
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={handleLogout}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {t.nav.logout}
          </button>
        </div>
      )}
    </div>
  );
}
