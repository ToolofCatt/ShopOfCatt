import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n/client';
import { LOCALE_HTML_LANG } from '@/lib/i18n/config';
import { getServerDictionary } from '@/lib/i18n/server';
import { SITE_URL } from '@/lib/site';
import { Header } from '@/components/header';
import './globals.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Catt Store';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getServerDictionary();
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: SITE_NAME,
      template: `%s — ${SITE_NAME}`,
    },
    description: t.meta.description,
    applicationName: SITE_NAME,
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: t.meta.description,
      url: SITE_URL,
      locale,
    },
    twitter: {
      card: 'summary',
      title: SITE_NAME,
      description: t.meta.description,
    },
    // Trang quản trị, thanh toán, đơn hàng đều là nội dung riêng tư —
    // chặn lập chỉ mục ở tầng robots.ts, đây chỉ là mặc định cho phần công khai.
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getServerDictionary();

  return (
    <html
      lang={LOCALE_HTML_LANG[locale]}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-white text-neutral-950 antialiased">
        <I18nProvider initialLocale={locale}>
          <AuthProvider>
            <Header />
            <main className="flex-1">{children}</main>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
