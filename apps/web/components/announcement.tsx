import { Megaphone } from 'lucide-react';
import type { AnnouncementDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { getServerDictionary } from '@/lib/i18n/server';

/**
 * Thông báo trang chủ (server component — tự gọi `GET /announcement`).
 * Không render gì khi thông báo đang tắt, không có nội dung, hoặc API lỗi.
 */
export async function Announcement() {
  const { locale, t } = await getServerDictionary();

  let announcement: AnnouncementDto | null = null;
  try {
    announcement = await apiFetch<AnnouncementDto>('/announcement', { locale });
  } catch {
    return null;
  }

  if (!announcement?.active) return null;

  const title = announcement.title?.trim() ?? '';
  // Nội dung là HTML đã được MÁY CHỦ lọc theo danh sách thẻ cho phép khi lưu
  // (src/announcement/sanitize-announcement.ts) — không lọc lại ở đây.
  const body = announcement.body?.trim() ?? '';
  const bodyHasText = body.replace(/<[^>]*>/g, '').trim() !== '';
  if (!title && !bodyHasText) return null;

  return (
    <section
      aria-label={t.home.announcementLabel}
      className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4"
    >
      <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-neutral-500" strokeWidth={1.75} />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-neutral-950">{title}</p>}
        {bodyHasText && (
          <div
            className="wc-prose text-sm leading-relaxed text-neutral-600"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
      </div>
    </section>
  );
}
