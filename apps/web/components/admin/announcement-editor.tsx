'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Megaphone, ServerCrash } from 'lucide-react';
import type { AdminAnnouncementDto } from '@webcatt/shared';
import { TRANSLATABLE_LOCALES } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button, Card, EmptyState, Field, Input, Spinner } from '@/components/ui';
import { localeLabel } from '@/components/admin/helpers';
import { RichTextEditor } from '@/components/admin/rich-text-editor';
import { TranslationSection, type TranslationBlock } from '@/components/admin/translation';

interface AnnouncementFieldErrors {
  title?: string;
  body?: string;
}

/** Nội dung HTML có chữ thật hay chỉ còn thẻ rỗng ("<p><br></p>"). */
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() !== '';
}

/** Bỏ thẻ HTML, mỗi đoạn/dòng thành một dòng chữ — dùng để xem bản dịch. */
function stripTags(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trình soạn thông báo trang chủ: bản tiếng Việt + bản dịch EN/ZH chỉ đọc. */
export function AnnouncementEditor() {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [data, setData] = useState<AdminAnnouncementDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [active, setActive] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const [fieldErrors, setFieldErrors] = useState<AnnouncementFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Đồng bộ biểu mẫu với dữ liệu máy chủ vừa trả về. */
  const apply = useCallback((next: AdminAnnouncementDto) => {
    setData(next);
    setActive(next.active);
    setTitle(next.title);
    setBody(next.body);
  }, []);

  useEffect(() => {
    let mounted = true;
    apiFetch<AdminAnnouncementDto>('/admin/announcement', { token })
      .then((result) => {
        if (mounted) apply(result);
      })
      .catch((err: unknown) => {
        if (mounted) setLoadError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      mounted = false;
    };
  }, [token, apply, t]);

  /** Bắt buộc có tiêu đề + nội dung khi bật hiển thị. */
  const validate = (): AnnouncementFieldErrors | null => {
    if (!active) return null;
    const errors: AnnouncementFieldErrors = {};
    if (!title.trim()) errors.title = t.admin.errAnnouncementTitleRequired;
    if (!hasText(body)) errors.body = t.admin.errAnnouncementBodyRequired;
    return Object.keys(errors).length > 0 ? errors : null;
  };

  const persist = async (): Promise<AdminAnnouncementDto> =>
    apiFetch<AdminAnnouncementDto>('/admin/announcement', {
      method: 'PUT',
      body: { active, title: title.trim(), body: hasText(body) ? body : '' },
      token,
    });

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const errors = validate();
    setFieldErrors(errors ?? {});
    if (errors) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      apply(await persist());
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSaving(false);
    }
  };

  /** Lưu bản tiếng Việt rồi dịch — bảo đảm bản dịch khớp nội dung đang xem. */
  const handleTranslate = async () => {
    const errors = validate();
    setFieldErrors(errors ?? {});
    if (errors) throw new Error(t.admin.translateFixForm);
    if (!title.trim() && !hasText(body)) throw new Error(t.admin.translateNothing);

    await persist();
    apply(
      await apiFetch<AdminAnnouncementDto>('/admin/announcement/translate', {
        method: 'POST',
        token,
      }),
    );
  };

  if (loadError) {
    return (
      <EmptyState
        icon={ServerCrash}
        title={t.admin.announcementLoadError}
        hint={loadError}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (data === null) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  const blocks: TranslationBlock[] = TRANSLATABLE_LOCALES.map((locale) => ({
    locale,
    label: localeLabel(locale, t),
    fields: [
      { label: t.admin.transFieldTitle, value: data.translations[locale]?.title ?? '' },
      {
        label: t.admin.transFieldBody,
        // Bản dịch là HTML — bỏ thẻ để admin đọc phần chữ cho dễ.
        value: stripTags(data.translations[locale]?.body ?? ''),
        multiline: true,
      },
    ],
  }));

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
          <label
            htmlFor="announcement-active"
            className={cn(
              'flex h-10 w-full cursor-pointer select-none items-center gap-2.5 rounded-lg border border-neutral-300 px-3',
              'text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-500 sm:w-auto',
            )}
          >
            <input
              id="announcement-active"
              type="checkbox"
              checked={active}
              onChange={(event) => {
                setActive(event.target.checked);
                setSaved(false);
              }}
              className="h-4 w-4 cursor-pointer accent-neutral-950"
            />
            {t.admin.announcementActive}
          </label>

          <Field
            label={t.admin.announcementFieldTitle}
            htmlFor="announcement-title"
            error={fieldErrors.title}
          >
            <Input
              id="announcement-title"
              value={title}
              invalid={Boolean(fieldErrors.title)}
              placeholder={t.admin.announcementTitlePlaceholder}
              onChange={(event) => {
                setTitle(event.target.value);
                setSaved(false);
              }}
            />
          </Field>

          <Field
            label={t.admin.announcementFieldBody}
            htmlFor="announcement-body"
            error={fieldErrors.body}
            hint={t.admin.announcementBodyHint}
          >
            <RichTextEditor
              id="announcement-body"
              value={body}
              invalid={Boolean(fieldErrors.body)}
              placeholder={t.admin.announcementBodyPlaceholder}
              onChange={(html) => {
                setBody(html);
                setSaved(false);
              }}
            />
          </Field>

          {/* Xem trước đúng như khách nhìn thấy trên trang chủ. */}
          {hasText(body) && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-neutral-800">
                {t.admin.announcementPreview}
              </p>
              <section className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <Megaphone
                  className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500"
                  strokeWidth={1.75}
                />
                <div className="min-w-0 space-y-1">
                  {title.trim() && (
                    <p className="font-medium text-neutral-950">{title}</p>
                  )}
                  <div
                    className="wc-prose text-sm leading-relaxed text-neutral-600"
                    dangerouslySetInnerHTML={{ __html: body }}
                  />
                </div>
              </section>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && !error && (
            <p className="text-sm font-medium text-emerald-600">{t.admin.announcementSaved}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            <Button type="submit" loading={saving}>
              {t.common.save}
            </Button>
            <span className="text-xs text-neutral-500">
              {t.admin.announcementUpdatedAt(formatDate(data.updatedAt))}
            </span>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <TranslationSection blocks={blocks} onTranslate={handleTranslate} />
      </Card>
    </div>
  );
}
