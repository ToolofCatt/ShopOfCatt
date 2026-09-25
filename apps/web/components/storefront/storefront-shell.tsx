'use client';

import { Wrench } from 'lucide-react';
import Link from 'next/link';
import { SupportPanel } from '@/components/support-panel';
import { isCustomerAfterSalesPath } from '@/lib/customer-navigation';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { StorefrontBlockType, StorefrontPageKind } from '@webcatt/shared';
import { Header } from '@/components/header';
import { useI18n } from '@/lib/i18n/client';
import { useStorefront } from '@/lib/storefront';
import { StorefrontRenderer } from './storefront-renderer';
import { StoreSectionNav } from '@/components/mail/store-section-nav';

export function StorefrontShell({ children, announcement }: { children: ReactNode; announcement: ReactNode }) {
  const pathname = usePathname();
  const store = useStorefront();
  const { t } = useI18n();
  const paused = !store.published || store.maintenanceMode;
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  const afterSales = isCustomerAfterSalesPath(pathname);
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-neutral-950 px-4 py-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">{t.customerUx.skipToContent}</a>
      {paused && !admin ? <header className="border-b border-neutral-200 px-4 py-3">
        <nav aria-label={t.customerUx.maintenanceTitle} className="mx-auto flex max-w-6xl flex-wrap gap-x-5">
          <Link className="inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/orders">{t.nav.myOrders}</Link>
          <Link className="inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/account">{t.account.title}</Link>
          <Link className="inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/login">{t.auth.loginTitle}</Link>
        </nav>
        {afterSales && <p className="mx-auto max-w-6xl text-sm text-neutral-600">{t.customerUx.maintenanceHint}</p>}
      </header> : <Header />}
      {!paused && (pathname === '/' || pathname.startsWith('/mail')) && <StoreSectionNav />}
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1">
        {paused && !admin ? (afterSales ? children : <Maintenance />) : <AutoFrame pathname={pathname} announcement={announcement}>{children}</AutoFrame>}
      </main>
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
  const { t } = useI18n();
  const store = useStorefront();
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-12">
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100"><Wrench className="h-5 w-5" /></span>
      <p className="mt-6 text-xs font-semibold uppercase text-neutral-500">{store.document.brand.name}</p>
      <h1 className="mt-2 text-3xl font-semibold">{t.customerUx.maintenanceTitle}</h1>
      <p className="mt-3 text-sm leading-6 text-neutral-600">{t.customerUx.maintenanceHint}</p>
      <div className="mt-8"><SupportPanel /></div>
    </section>
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
  if (pathname === '/account/api') return null;
  if (pathname.startsWith('/account')) return { page: 'account', block: 'accountPanel' };
  if (pathname.startsWith('/legal/')) return { page: 'legal', block: 'legalContent' };
  return null;
}
