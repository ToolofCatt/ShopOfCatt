'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  KeyRound,
  LayoutDashboard,
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
    { href: '/admin/telegram', label: t.admin.navTelegram, icon: Send },
    { href: '/admin/announcement', label: t.admin.navAnnouncement, icon: Megaphone },
    { href: '/admin/legal', label: t.admin.navLegal, icon: FileText },
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

        {/*
          Đổi mật khẩu vốn chỉ nằm trong menu tài khoản ở header — mà nút mở menu
          đó chỉ hiện dãy số mã khách hàng, nhìn không ra là menu. Chủ shop làm
          việc trong trang quản trị thì tìm ở thanh bên và trang Cấu hình, cả hai
          đều không có, nên tưởng hệ thống không cho đổi mật khẩu.
        */}
        {/* active={false}: thanh bên chỉ tồn tại trong /admin/*, rời khỏi đó là
            nó tháo luôn nên không bao giờ tự tô sáng được — giống mục "Về cửa hàng". */}
        <NavLink
          item={{ href: '/account/password', label: t.nav.changePassword, icon: KeyRound }}
          active={false}
        />

        <NavLink item={{ href: '/', label: t.admin.navStore, icon: Store }} active={false} />
      </div>
    </aside>
  );
}
