'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, ServerCrash } from 'lucide-react';
import {
  LEGAL_PAGE_SLUGS,
  type LegalPageDto,
  type LegalPageSlug,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { Tabs, type TabItem } from '@/components/admin/tabs';
import { RichTextEditor } from '@/components/admin/rich-text-editor';

function slugLabel(slug: LegalPageSlug, t: Dictionary): string {
  if (slug === 'terms') return t.legal.termsTitle;
  if (slug === 'refund') return t.legal.refundTitle;
  return t.legal.privacyTitle;
}

/** Nội dung HTML có chữ thật hay chỉ còn thẻ rỗng. */
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() !== '';
}

export default function AdminLegalPage() {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [pages, setPages] = useState<LegalPageDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<LegalPageSlug>('terms');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Nạp nội dung của trang đang chọn vào biểu mẫu. */
  const load = (list: LegalPageDto[], slug: LegalPageSlug) => {
    const page = list.find((p) => p.slug === slug);
    setTitle(page?.title ?? '');
    setBody(page?.body ?? '');
    setSaved(false);
    setSaveError(null);
  };

  useEffect(() => {
    let mounted = true;
    apiFetch<LegalPageDto[]>('/admin/legal', { token })
      .then((data) => {
        if (!mounted) return;
        setPages(data);
        load(data, 'terms');
      })
      .catch((err: unknown) => {
        if (mounted) setLoadError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      mounted = false;
    };
  }, [token, t]);

  const handleSelect = (slug: LegalPageSlug) => {
    if (!pages || slug === active) return;
    setActive(slug);
    load(pages, slug);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await apiFetch<LegalPageDto>(`/admin/legal/${active}`, {
        method: 'PUT',
        body: {
          title: title.trim(),
          body: hasText(body) ? body : '',
        },
        token,
      });
      setPages((current) =>
        current
          ? current.map((p) => (p.slug === updated.slug ? updated : p))
          : [updated],
      );
      setSaved(true);
    } catch (err) {
      setSaveError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <>
        <PageHeader title={t.admin.legalTitle} />
        <EmptyState
          icon={ServerCrash}
          title={t.admin.legalLoadError}
          hint={loadError}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      </>
    );
  }

  if (pages === null) {
    return (
      <>
        <PageHeader title={t.admin.legalTitle} />
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      </>
    );
  }

  const tabs: TabItem<LegalPageSlug>[] = LEGAL_PAGE_SLUGS.map((slug) => ({
    value: slug,
    label: slugLabel(slug, t),
  }));
  const current = pages.find((p) => p.slug === active);

  return (
    <>
      <PageHeader
        title={t.admin.legalTitle}
        description={t.admin.legalSubtitle}
        actions={
          <Link
            href={`/legal/${active}`}
            target="_blank"
            className="flex items-center gap-1.5 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-950 hover:underline"
          >
            {t.admin.legalViewPublic}
            <ExternalLink strokeWidth={1.75} className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="space-y-4">
        <Tabs items={tabs} value={active} onChange={handleSelect} />

        <Card className="space-y-4 p-6">
          <Field label={t.admin.legalFieldTitle} htmlFor="legal-title">
            <Input
              id="legal-title"
              value={title}
              placeholder={slugLabel(active, t)}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
            />
          </Field>

          <Field
            label={t.admin.legalFieldBody}
            htmlFor="legal-body"
            hint={t.admin.legalBodyHint}
          >
            <RichTextEditor
              id="legal-body"
              value={body}
              placeholder={t.admin.legalBodyPlaceholder}
              onChange={(html) => {
                setBody(html);
                setSaved(false);
              }}
            />
          </Field>

          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saved && !saveError && (
            <p className="text-sm font-medium text-emerald-600">
              {t.admin.legalSaved}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            <Button loading={saving} onClick={() => void handleSave()}>
              {t.common.save}
            </Button>
            {current && current.updatedAt !== new Date(0).toISOString() && (
              <span className="text-xs text-neutral-500">
                {t.admin.legalUpdatedAt(formatDate(current.updatedAt))}
              </span>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
