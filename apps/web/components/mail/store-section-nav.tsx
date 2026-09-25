'use client';
import Link from 'next/link';
import { Mail, Package } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n/client';
export function StoreSectionNav() {
  const pathname = usePathname(), { t } = useI18n();
  return <nav aria-label={t.mail.products} className="mx-auto flex w-full max-w-[1360px] gap-6 border-b border-neutral-200 px-4 sm:px-7">
    {[{ href: '/', name: t.mail.products, Icon: Package, active: pathname === '/' }, { href: '/mail/gmail', name: t.mail.nav, Icon: Mail, active: pathname.startsWith('/mail') }].map(({ href, name, Icon, active }) => <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`inline-flex min-h-12 items-center gap-2 border-b-2 text-sm ${active ? 'border-neutral-950 font-semibold text-neutral-950' : 'border-transparent text-neutral-600'}`}><Icon size={16} />{name}</Link>)}
  </nav>;
}
