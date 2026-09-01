'use client';

import { Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { StorefrontBlockType, StorefrontPageKind } from '@webcatt/shared';
import { Header } from '@/components/header';
import { useI18n } from '@/lib/i18n/client';
import { useStorefront } from '@/lib/storefront';
import { StorefrontRenderer } from './storefront-renderer';

export function StorefrontShell({ children, announcement }: { children: ReactNode; announcement: ReactNode }) {
  const pathname = usePathname();
  const store = useStorefront();
  const exempt = pathname.startsWith('/admin') || pathname === '/login' || pathname.startsWith('/account/password') || pathname.startsWith('/mock-pay');
  if ((!store.published || store.maintenanceMode) && !exempt) return <Maintenance />;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1"><AutoFrame pathname={pathname} announcement={announcement}>{children}</AutoFrame></main>
    </div>
  );
}

function AutoFrame({ pathname, children, announcement }: { pathname: string; children: ReactNode; announcement: ReactNode }) {
  const { locale } = useI18n();
  const store = useStorefront();
  const route = routeTemplate(pathname);
  if (!route) return children;
  return <StorefrontRenderer document={store.document} page={route.page} locale={locale} slots={{ [route.block]: children, ...(route.page === 'home' ? { announcement } : {}) }} />;
}

function Maintenance() {
  const { locale } = useI18n();
  const store = useStorefront();
  const title = locale === 'vi' ? 'Cửa hàng đang được thiết lập' : locale === 'zh' ? '商店正在设置中' : 'Store setup in progress';
  const detail = locale === 'vi' ? 'Vui lòng quay lại sau khi chủ cửa hàng hoàn tất cấu hình và xuất bản.' : locale === 'zh' ? '店主完成设置并发布后，请稍后再来。' : 'Please return after the owner completes setup and publishes the store.';
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--store-background)] px-6">
      <div className="w-full max-w-xl border-y border-[var(--store-border)] py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--store-radius)] bg-[var(--store-primary)] text-[var(--store-primary-foreground)]"><Wrench className="h-5 w-5" /></span>
        <p className="mt-6 text-xs font-semibold uppercase text-[var(--store-muted)]">{store.document.brand.name}</p>
        <h1 className="mt-2 text-3xl font-semibold" style={{ fontFamily: 'var(--store-heading-font)' }}>{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--store-muted)]">{detail}</p>
        <div className="mt-8"><StorefrontRenderer document={store.document} page="maintenance" locale={locale} slots={{ maintenanceMessage: null }} /></div>
      </div>
    </main>
  );
}

function routeTemplate(pathname: string): { page: StorefrontPageKind; block: StorefrontBlockType } | null {
  if (pathname === '/') return { page: 'home', block: 'productBrowser' };
  if (pathname.startsWith('/products/')) return { page: 'product', block: 'productDetail' };
  if (pathname === '/login') return { page: 'login', block: 'loginForm' };
  if (pathname === '/register') return { page: 'register', block: 'registerForm' };
  if (pathname.startsWith('/checkout/')) return { page: 'checkout', block: 'checkoutPanel' };
  if (pathname === '/orders') return { page: 'orders', block: 'ordersList' };
  if (pathname.startsWith('/orders/')) return { page: 'orderDetail', block: 'orderDetailPanel' };
  if (pathname.startsWith('/account')) return { page: 'account', block: 'accountPanel' };
  if (pathname.startsWith('/legal/')) return { page: 'legal', block: 'legalContent' };
  return null;
}
