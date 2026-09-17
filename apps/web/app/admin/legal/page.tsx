'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, ServerCrash } from 'lucide-react';
import { LEGAL_PAGE_SLUGS, type LegalPageDto, type LegalPageSlug } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { Tabs, type TabItem } from '@/components/admin/tabs';
import { RichTextEditor } from '@/components/admin/rich-text-editor';
import { editDraft, hasPolicyText, isDraftDirty, policyDrafts, settlePolicy, type PolicyDrafts, type PolicyValues } from '@/lib/settings-drafts';

function slugLabel(slug: LegalPageSlug, t: Dictionary): string {
  if (slug === 'terms') return t.legal.termsTitle;
  if (slug === 'refund') return t.legal.refundTitle;
  return t.legal.privacyTitle;
}

export default function AdminLegalPage() {
  const { token } = useAuth();
  const { t, locale, formatDate } = useI18n();
  const [pages, setPages] = useState<LegalPageDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<LegalPageSlug>('terms');
  const [drafts, setDrafts] = useState<PolicyDrafts>(() => policyDrafts([]));
  const draftsRef = useRef(drafts);
  const [retry, setRetry] = useState(0);
  const context = useRef({ locale, connectionError: t.common.connectionError });
  context.current = { locale, connectionError: t.common.connectionError };
  const session = useRef(0);
  const changeDrafts = (update: (current: PolicyDrafts) => PolicyDrafts) => {
    draftsRef.current = update(draftsRef.current);
    setDrafts(draftsRef.current);
  };

  useEffect(() => {
    const generation = ++session.current;
    setPages(null);
    setLoadError(null);
    changeDrafts(() => policyDrafts([]));
    if (token) apiFetch<LegalPageDto[]>('/admin/legal', { token, locale: context.current.locale })
      .then((data) => {
        if (generation !== session.current) return;
        setPages(data);
        changeDrafts(() => policyDrafts(data));
      })
      .catch((err: unknown) => {
        if (generation === session.current) setLoadError(apiErrorMessage(err, context.current.connectionError));
      });
    // Đổi ngôn ngữ không đổi nội dung chính sách, nên không được nạp đè bản nháp.
    return () => { session.current++; };
  }, [token, retry]);

  const editPolicy = (slug: LegalPageSlug, patch: Partial<PolicyValues>) => {
    changeDrafts((current) => ({ ...current, [slug]: editDraft(current[slug], patch) }));
  };
  const handleSave = async () => {
    const slug = active;
    if (!token || draftsRef.current[slug].saving) return;
    const sent = draftsRef.current[slug].draft;
    const generation = session.current;
    changeDrafts((current) => ({ ...current, [slug]: { ...current[slug], saving: true, saved: false, error: null } }));
    try {
      const updated = await apiFetch<LegalPageDto>(`/admin/legal/${slug}`, {
        method: 'PUT', body: { title: sent.title.trim(), body: hasPolicyText(sent.body) ? sent.body : '' }, token, locale,
      });
      if (generation !== session.current) return;
      changeDrafts((current) => settlePolicy(current, slug, sent, updated));
      setPages((current) => current ? [...current.filter((page) => page.slug !== slug), updated] : [updated]);
    } catch (err) {
      if (generation !== session.current) return;
      changeDrafts((current) => ({ ...current, [slug]: { ...current[slug], saving: false, saved: false, error: apiErrorMessage(err, t.common.connectionError) } }));
    }
  };

  if (loadError) return <><PageHeader title={t.admin.legalTitle} /><EmptyState icon={ServerCrash} title={t.admin.legalLoadError} hint={loadError} action={<Button variant="outline" onClick={() => setRetry((value) => value + 1)}>{t.common.retry}</Button>} /></>;
  if (pages === null) return <><PageHeader title={t.admin.legalTitle} /><div className="flex justify-center py-24"><Spinner className="h-6 w-6 text-neutral-400" /></div></>;

  const tabs: TabItem<LegalPageSlug>[] = LEGAL_PAGE_SLUGS.map((slug) => ({ value: slug, label: `${slugLabel(slug, t)}${isDraftDirty(drafts[slug]) ? ' *' : ''}` }));
  const current = pages.find((page) => page.slug === active);
  const { draft: { title, body }, saving, saved, error } = drafts[active];
  return (
    <>
      <PageHeader title={t.admin.legalTitle} description={t.admin.legalSubtitle} actions={
        <Link href={`/legal/${active}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-neutral-500 underline-offset-4 hover:text-neutral-950 hover:underline">
          {t.admin.legalViewPublic}<ExternalLink strokeWidth={1.75} className="h-3.5 w-3.5" />
        </Link>
      } />
      <p className="mb-4 text-sm text-neutral-500">{t.settingsUx.legalDraftHint}</p>
      <div className="space-y-4">
        <Tabs idPrefix="legal" label={t.admin.legalTitle} items={tabs} value={active} onChange={setActive} />
        <section id={`legal-panel-${active}`} role="tabpanel" aria-labelledby={`legal-tab-${active}`}>
          <Card className="space-y-4 p-4 sm:p-6">
            {!hasPolicyText(body) && <p role="status" className="border-l-2 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{t.settingsUx.legalEmptyWarning}</p>}
            <Field label={t.admin.legalFieldTitle} htmlFor={`legal-title-${active}`}>
              <Input id={`legal-title-${active}`} value={title} placeholder={slugLabel(active, t)} onChange={(event) => editPolicy(active, { title: event.target.value })} />
            </Field>
            <Field label={t.admin.legalFieldBody} htmlFor={`legal-body-${active}`} hint={t.admin.legalBodyHint}>
              <RichTextEditor key={active} id={`legal-body-${active}`} value={body} placeholder={t.admin.legalBodyPlaceholder} onChange={(html) => editPolicy(active, { body: html })} />
            </Field>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
              <Button loading={saving} disabled={!isDraftDirty(drafts[active])} onClick={() => void handleSave()}>{t.common.save}</Button>
              <p role="status" className="text-sm text-neutral-600">{isDraftDirty(drafts[active]) ? t.settingsUx.unsaved : saved ? t.admin.legalSaved : t.settingsUx.upToDate}</p>
              {current && current.updatedAt !== new Date(0).toISOString() && <span className="text-xs text-neutral-500">{t.admin.legalUpdatedAt(formatDate(current.updatedAt))}</span>}
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
