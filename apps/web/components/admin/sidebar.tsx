'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  KeyRound,
  LayoutDashboard,
  Palette,
  ListChecks,
  Megaphone,
  FileText,
  Package,
  ReceiptText,
  ScrollText,
  Send,
  Settings,
  Store,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { useStorefront } from '@/lib/storefront';
import { MobileDrawer } from '../mobile-drawer';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950',
        active
          ? 'bg-neutral-950 text-white'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
      )}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{item.label}</span>
    </Link>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const store = useStorefront();
  const logo = store.mediaUrl(store.document.brand.logoAssetId) ?? '/logo-mark.png';

  const navItems: NavItem[] = [
    { href: '/admin', label: t.admin.navDashboard, icon: LayoutDashboard, exact: true },
    { href: '/admin/setup', label: t.admin.navSetup, icon: ListChecks },
    { href: '/admin/design', label: t.admin.navDesign, icon: Palette },
    { href: '/admin/products', label: t.admin.navProducts, icon: Package },
    { href: '/admin/orders', label: t.admin.navOrders, icon: ReceiptText },
    { href: '/admin/reconciliation', label: t.adminUx.reconciliation, icon: ArrowLeftRight },
    { href: '/admin/customers', label: t.admin.navCustomers, icon: Users },
    { href: '/admin/coupons', label: t.admin.navCoupons, icon: Ticket },
    { href: '/admin/audit', label: t.admin.navAudit, icon: ScrollText },
    { href: '/admin/settings', label: t.admin.navSettings, icon: Settings },
    { href: '/admin/telegram', label: t.admin.navTelegram, icon: Send },
    { href: '/admin/announcement', label: t.admin.navAnnouncement, icon: Megaphone },
    { href: '/admin/legal', label: t.admin.navLegal, icon: FileText },
  ];

  // Hai bề mặt dùng chung danh sách để mobile không thiếu mục quản trị mới.
  const navigation = (
    <nav aria-label={t.adminUx.navigationLabel} className="flex min-w-0 flex-col gap-1">
      {navItems.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`))}
        />
      ))}
      <div className="my-2 border-t border-neutral-200" aria-hidden="true" />
      {/* Đổi mật khẩu phải tìm được trong quản trị, không chỉ trong menu tài khoản. */}
      <NavLink
        item={{ href: '/account/password', label: t.nav.changePassword, icon: KeyRound }}
        active={false}
      />
      <NavLink item={{ href: '/', label: t.admin.navStore, icon: Store }} active={false} />
    </nav>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 bg-white md:block">
        <div className="sticky top-16 flex max-h-[calc(100dvh-4rem)] flex-col gap-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center gap-2.5 px-2 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg object-contain" />
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-950">
              {t.admin.brand}
            </span>
          </div>
          {navigation}
        </div>
      </aside>
      <div className="min-w-0 border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <MobileDrawer
          title={t.adminUx.navigationLabel}
          triggerLabel={t.adminUx.openNavigation}
          closeLabel={t.adminUx.closeNavigation}
          routeKey={pathname}
        >
          {navigation}
        </MobileDrawer>
      </div>
    </>
  );
}
