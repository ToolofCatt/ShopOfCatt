import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState, buttonVariants } from '@/components/ui';
import { getServerDictionary } from '@/lib/i18n/server';

export default async function NotFound() {
  const { t } = await getServerDictionary();

  return (
    <div className="mx-auto max-w-6xl px-4 py-24">
      <EmptyState
        icon={SearchX}
        title={t.notFound.title}
        hint={t.notFound.hint}
        action={
          <Link href="/" className={buttonVariants({ variant: 'outline' })}>
            {t.notFound.backHome}
          </Link>
        }
      />
    </div>
  );
}
