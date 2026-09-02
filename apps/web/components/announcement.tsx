import type { AnnouncementDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { getServerDictionary } from '@/lib/i18n/server';
import { AnnouncementCard } from './announcement-card';

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

  return announcement
    ? <AnnouncementCard announcement={announcement} label={t.home.announcementLabel} />
    : null;
}
