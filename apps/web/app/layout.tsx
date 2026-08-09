import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { AuthProvider } from '@/lib/auth';
import { I18nProvider } from '@/lib/i18n/client';
import { LOCALE_HTML_LANG } from '@/lib/i18n/config';
import { getServerDictionary } from '@/lib/i18n/server';
import { Header } from '@/components/header';
import './globals.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Catt Store';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerDictionary();
  return {
    title: {
      default: SITE_NAME,
      template: `%s — ${SITE_NAME}`,
    },
    description: t.meta.description,
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
