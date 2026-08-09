'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Megaphone,
  Package,
  ReceiptText,
  ScrollText,
  Settings,
  Store,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the pathname exactly (used for the dashboard root). */
  exact?: boolean;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-neutral-950 text-white'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
      )}
    >
      <Icon strokeWidth={1.75} className="h-4 w-4 shrink-0" />
      <span className="hidden md:inline">{item.label}</span>
    </Link>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const { t } = useI18n();

  const navItems: NavItem[] = [
    { href: '/admin', label: t.admin.navDashboard, icon: LayoutDashboard, exact: true },
    { href: '/admin/products', label: t.admin.navProducts, icon: Package },
    { href: '/admin/orders', label: t.admin.navOrders, icon: ReceiptText },
    { href: '/admin/customers', label: t.admin.navCustomers, icon: Users },
    { href: '/admin/coupons', label: t.admin.navCoupons, icon: Ticket },
    { href: '/admin/audit', label: t.admin.navAudit, icon: ScrollText },
    { href: '/admin/settings', label: t.admin.navSettings, icon: Settings },
    { href: '/admin/announcement', label: t.admin.navAnnouncement, icon: Megaphone },
  ];

  return (
    <aside className="w-[3.75rem] shrink-0 border-r border-neutral-200 bg-white md:w-60">
      <div className="sticky top-16 flex flex-col gap-1 p-2 md:p-3">
        <div className="mb-2 flex items-center gap-2.5 px-2 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.png"
            alt={t.admin.brand}
            className="h-8 w-8 shrink-0 rounded-lg object-contain"
          />
          <span className="hidden text-xs font-semibold uppercase tracking-widest text-neutral-950 md:inline">
            {t.admin.brand}
          </span>
        </div>

        {navItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={item.exact ? pathname === item.href : pathname.startsWith(item.href)}
          />
        ))}

        <div className="my-2 border-t border-neutral-200" aria-hidden="true" />

        <NavLink item={{ href: '/', label: t.admin.navStore, icon: Store }} active={false} />
      </div>
    </aside>
  );
}
