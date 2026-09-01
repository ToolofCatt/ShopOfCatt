import type { Metadata } from 'next';
import { createDefaultStorefrontDocument, type PublicStorefrontDto, type StoreRatesDto } from '@webcatt/shared';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { apiFetch } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { RatesProvider } from '@/lib/prices';
import { I18nProvider } from '@/lib/i18n/client';
import { LOCALE_HTML_LANG } from '@/lib/i18n/config';
import { getServerDictionary } from '@/lib/i18n/server';
import { SITE_URL } from '@/lib/site';
import { StorefrontProvider } from '@/lib/storefront';
import { StorefrontShell } from '@/components/storefront/storefront-shell';
import { Announcement } from '@/components/announcement';
import './globals.css';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'Digital Store';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getServerDictionary();
  const storefront = await getStorefront();
  const siteName = storefront.document.brand.name || SITE_NAME;
  const faviconId = storefront.document.brand.faviconAssetId;
  const apiRoot = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: siteName,
      template: `%s — ${siteName}`,
    },
    description: t.meta.description,
    applicationName: siteName,
    icons: faviconId ? { icon: `${apiRoot}/storefront/media/${faviconId}` } : { icon: '/icon.png' },
    openGraph: {
      type: 'website',
      siteName,
      title: siteName,
      description: t.meta.description,
      url: SITE_URL,
      locale,
    },
    twitter: {
      card: 'summary',
      title: siteName,
      description: t.meta.description,
    },
    // Trang quản trị, thanh toán, đơn hàng đều là nội dung riêng tư —
    // chặn lập chỉ mục ở tầng robots.ts, đây chỉ là mặc định cho phần công khai.
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale } = await getServerDictionary();
  /*
    Tỉ giá lấy ở MÁY CHỦ rồi truyền xuống: thẻ sản phẩm hiện giá ngay lúc trang
    mở. Fetch ở trình duyệt thì giá nhảy từ USDT sang tiền địa phương trước mắt
    khách. Lỗi thì `null` — giao diện lặng lẽ hiện USDT như trước.
  */
  const rates = await apiFetch<StoreRatesDto>('/rates').catch(() => null);
  const storefront = await getStorefront();

  return (
    <html
      lang={LOCALE_HTML_LANG[locale]}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-screen bg-white text-neutral-950 antialiased">
        <I18nProvider initialLocale={locale}>
          <StorefrontProvider config={storefront}>
            <RatesProvider rates={rates}>
              <AuthProvider><StorefrontShell announcement={<Announcement />}>{children}</StorefrontShell></AuthProvider>
            </RatesProvider>
          </StorefrontProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

async function getStorefront(): Promise<PublicStorefrontDto> {
  return apiFetch<PublicStorefrontDto>('/storefront').catch(() => ({
    // Lỗi mạng tạm thời không được tự đóng cửa hàng đang hoạt động.
    published: true,
    maintenanceMode: false,
    document: createDefaultStorefrontDocument(SITE_NAME),
    revision: 0,
  }));
}
