import { Megaphone } from 'lucide-react';
import type { AnnouncementDto } from '@webcatt/shared';

export function AnnouncementCard({
  announcement,
  label,
}: {
  announcement: AnnouncementDto;
  label: string;
}) {
  if (!announcement.active) return null;

  const title = announcement.title?.trim() ?? '';
  // Nội dung là HTML đã được API lọc khi lưu; chỉ kiểm tra phần chữ để tránh
  // dựng một khung trống nếu admin chỉ nhập các thẻ không có nội dung.
  const body = announcement.body?.trim() ?? '';
  const bodyHasText = body.replace(/<[^>]*>/g, '').trim() !== '';
  if (!title && !bodyHasText) return null;

  return (
    <section
      aria-label={label}
      // Announcement là slot cấp cao nhất của Page Builder. Nó phải tự giữ
      // container, nếu không sẽ kéo từ mép này sang mép kia của viewport.
      className="mx-auto mt-6 flex gap-3 border border-[var(--store-border)] bg-[var(--store-surface)] p-4"
      style={{
        width: 'calc(100% - 2rem)',
        maxWidth: 'var(--store-container)',
        borderRadius: 'var(--store-radius)',
      }}
    >
      <Megaphone
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-[var(--store-muted)]"
        strokeWidth={1.75}
      />
      <div className="min-w-0 space-y-1">
        {title && <p className="break-words font-medium text-[var(--store-foreground)]">{title}</p>}
        {bodyHasText && (
          <div
            className="wc-prose text-sm leading-relaxed text-[var(--store-muted)] [overflow-wrap:anywhere]"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
      </div>
    </section>
  );
}
