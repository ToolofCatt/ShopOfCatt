'use client';

import { useI18n } from '@/lib/i18n/client';
import { PageHeader } from '@/components/admin/page-header';
import { AnnouncementEditor } from '@/components/admin/announcement-editor';

export default function AdminAnnouncementPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t.admin.announcementTitle}
        description={t.admin.announcementSubtitle}
      />
      <AnnouncementEditor />
    </div>
  );
}
