import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { isLegalPageSlug, type LegalPageDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { getServerDictionary } from '@/lib/i18n/server';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Tiêu đề mặc định khi chủ shop chưa soạn nội dung. */
async function pageTitle(slug: string): Promise<string> {
  const { t } = await getServerDictionary();
  if (slug === 'terms') return t.legal.termsTitle;
  if (slug === 'refund') return t.legal.refundTitle;
  return t.legal.privacyTitle;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isLegalPageSlug(slug)) return {};
  let title = await pageTitle(slug);
  try {
    const page = await apiFetch<LegalPageDto>(`/legal/${slug}`);
    if (page.title.trim()) title = page.title;
  } catch {
    // giữ tiêu đề mặc định
  }
  return {
    title,
    alternates: { canonical: `/legal/${slug}` },
    // Chính sách không cần lên top tìm kiếm, nhưng phải cho khách đọc được.
    robots: { index: true, follow: true },
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isLegalPageSlug(slug)) notFound();

  const { t } = await getServerDictionary();
  const fallbackTitle = await pageTitle(slug);

  let page: LegalPageDto | null = null;
  try {
    page = await apiFetch<LegalPageDto>(`/legal/${slug}`);
  } catch {
    page = null;
  }

  const title = page?.title.trim() || fallbackTitle;
  // Nội dung là HTML đã được MÁY CHỦ lọc theo allowlist khi lưu
  // (src/announcement/sanitize-announcement.ts).
  const body = page?.body ?? '';
  const hasBody = body.replace(/<[^>]*>/g, '').trim() !== '';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">
        {title}
      </h1>

      {hasBody ? (
        <>
          <div
            className="wc-prose mt-6 leading-relaxed text-neutral-700"
            dangerouslySetInnerHTML={{ __html: body }}
          />
          {page?.updatedAt && page.updatedAt !== new Date(0).toISOString() && (
            <p className="mt-8 border-t border-neutral-100 pt-4 text-xs text-neutral-400">
              {t.legal.updatedAt}{' '}
              {new Date(page.updatedAt).toLocaleDateString('vi-VN')}
            </p>
          )}
        </>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={FileText}
            title={t.legal.emptyTitle}
            hint={t.legal.emptyHint}
          />
        </div>
      )}
    </div>
  );
}
