'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicStoreInfoDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { Wordmark } from '@/components/wordmark';

/**
 * Chân trang tối giản — chỉ tồn tại để chứa link chính sách và kênh liên hệ.
 * Bán hàng số thì tranh chấp "key không dùng được" là chuyện thường ngày; khách
 * phải tìm được điều khoản và cách liên hệ mà không cần hỏi.
 *
 * Ẩn ở khu quản trị (đã có thanh bên riêng) và ở trang thanh toán (không nên
 * dụ khách rời trang giữa lúc trả tiền).
 */
export function Footer() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [info, setInfo] = useState<PublicStoreInfoDto | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<PublicStoreInfoDto>('/store-info')
      .then((data) => {
        if (active) setInfo(data);
      })
      .catch(() => {
        /* không có thông tin liên hệ thì chỉ hiện link chính sách */
      });
    return () => {
      active = false;
    };
  }, []);

  if (pathname.startsWith('/admin') || pathname.startsWith('/checkout')) {
    return null;
  }

  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Wordmark size="sm" />
          <p className="text-xs text-neutral-500">
            © {year} · {t.footer.rights}
          </p>
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
          <nav className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              {t.footer.policies}
            </p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link
                  href="/legal/terms"
                  className="text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline"
                >
                  {t.legal.termsTitle}
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/refund"
                  className="text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline"
                >
                  {t.legal.refundTitle}
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/privacy"
                  className="text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline"
                >
                  {t.legal.privacyTitle}
                </Link>
              </li>
            </ul>
          </nav>

          {info && info.supportChannels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                {t.footer.contact}
              </p>
              <ul className="space-y-1.5 text-sm">
                {info.supportChannels.map((channel, index) => (
                  <li key={`${channel.label}-${index}`}>
                    <span className="text-neutral-500">{channel.label}: </span>
                    {channel.url ? (
                      <a
                        href={channel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-neutral-950 underline-offset-4 hover:underline"
                      >
                        {channel.value}
                      </a>
                    ) : (
                      <span className="font-mono text-neutral-950">{channel.value}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
