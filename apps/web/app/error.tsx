'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ServerCrash } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { Button, EmptyState, buttonVariants } from '@/components/ui';

/**
 * Bắt lỗi kết xuất của mọi trang. Không có file này, một lỗi JavaScript sẽ hiện
 * trang trắng "Application error: a client-side exception has occurred" —
 * khách không biết chuyện gì và không có đường quay lại.
 */
export default function GlobalRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    // Ghi ra console để còn lần được dấu vết khi khách báo lỗi.
    // eslint-disable-next-line no-console
    console.error('Lỗi kết xuất trang:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-24">
      <EmptyState
        icon={ServerCrash}
        title={t.errorPage.title}
        hint={t.errorPage.hint}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset}>{t.errorPage.retry}</Button>
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              {t.errorPage.backHome}
            </Link>
          </div>
        }
      />
      {error.digest && (
        <p className="mt-4 text-center font-mono text-xs text-neutral-400">
          {t.errorPage.code}: {error.digest}
        </p>
      )}
    </div>
  );
}
