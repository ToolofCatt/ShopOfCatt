import { Injectable } from '@nestjs/common';
import type {
  Announcement,
  AnnouncementTranslation,
  User,
} from '@prisma/client';
import {
  TRANSLATABLE_LOCALES,
  type AdminAnnouncementDto,
  type AnnouncementDto,
  type TranslatableLocale,
} from '@webcatt/shared';
import { diffChanges } from '../audit/audit-diff';
import { AuditService } from '../audit/audit.service';
import type { Locale } from '../i18n/locale';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../translation/translation.service';
import { ANNOUNCEMENT_ID } from './announcement.constants';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { sanitizeAnnouncementHtml } from './sanitize-announcement';

type AnnouncementWithTranslations = Announcement & {
  translations: AnnouncementTranslation[];
};

const HIDDEN: AnnouncementDto = { active: false, title: '', body: '' };

function isTranslatableLocale(value: string): value is TranslatableLocale {
  return (TRANSLATABLE_LOCALES as readonly string[]).includes(value);
}

@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly translation: TranslationService,
    private readonly audit: AuditService,
  ) {}

  /** Endpoint công khai — đã dịch, tắt thì trả về hộp rỗng. */
  async getPublic(locale: Locale): Promise<AnnouncementDto> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: ANNOUNCEMENT_ID },
      include: { translations: { where: { locale } } },
    });
    if (!announcement || !announcement.active) return { ...HIDDEN };

    const translated =
      locale === 'vi'
        ? undefined
        : announcement.translations.find((row) => row.locale === locale);

    return {
      active: true,
      title: pick(translated?.title, announcement.title),
      body: pick(translated?.body, announcement.body),
    };
  }

  /** Trang quản trị — bản gốc tiếng Việt kèm toàn bộ bản dịch. */
  async getAdmin(): Promise<AdminAnnouncementDto> {
    const announcement = await this.prisma.announcement.upsert({
      where: { id: ANNOUNCEMENT_ID },
      create: { id: ANNOUNCEMENT_ID },
      update: {},
      include: { translations: true },
    });
    return toAdminDto(announcement);
  }

  async update(
    actor: User,
    dto: UpdateAnnouncementDto,
  ): Promise<AdminAnnouncementDto> {
    const before = await this.prisma.announcement.findUnique({
      where: { id: ANNOUNCEMENT_ID },
      select: { active: true, title: true, body: true },
    });
    const data = {
      active: dto.active,
      title: dto.title.trim(),
      // Nội dung là HTML từ trình soạn thảo — lọc ở máy chủ, không tin trình duyệt.
      body: sanitizeAnnouncementHtml(dto.body),
    };
    await this.prisma.announcement.upsert({
      where: { id: ANNOUNCEMENT_ID },
      create: { id: ANNOUNCEMENT_ID, ...data },
      update: data,
    });

    const changes = diffChanges(
      before ?? { active: false, title: '', body: '' },
      data,
    );
    await this.audit.log(
      actor,
      'announcement.update',
      { type: 'announcement', id: ANNOUNCEMENT_ID },
      Object.keys(changes).length > 0 ? { changes } : undefined,
    );

    for (const locale of TRANSLATABLE_LOCALES) {
      const side = dto.translations?.[locale];
      if (!side) continue;
      const translated = {
        title: (side.title ?? '').trim(),
        // Bản dịch cũng là HTML (do máy dịch sinh ra) → lọc y như bản gốc.
        body: sanitizeAnnouncementHtml(side.body ?? ''),
      };
      await this.prisma.announcementTranslation.upsert({
        where: {
          announcementId_locale: { announcementId: ANNOUNCEMENT_ID, locale },
        },
        create: { announcementId: ANNOUNCEMENT_ID, locale, ...translated },
        update: translated,
      });
    }

    return this.getAdmin();
  }

  /** Dịch vi → en + zh rồi lưu lại (await, lỗi trả về cho quản trị viên). */
  async translate(actor: User): Promise<AdminAnnouncementDto> {
    await this.translation.translateAnnouncement();
    await this.audit.log(actor, 'announcement.translate', {
      type: 'announcement',
      id: ANNOUNCEMENT_ID,
    });
    return this.getAdmin();
  }
}

/** Bản dịch rỗng → dùng bản gốc tiếng Việt. */
function pick(translated: string | undefined, original: string): string {
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated
    : original;
}

function toAdminDto(
  announcement: AnnouncementWithTranslations,
): AdminAnnouncementDto {
  const translations: AdminAnnouncementDto['translations'] = {};
  for (const row of announcement.translations) {
    if (!isTranslatableLocale(row.locale)) continue;
    translations[row.locale] = { title: row.title, body: row.body };
  }
  return {
    active: announcement.active,
    title: announcement.title,
    body: announcement.body,
    translations,
    updatedAt: announcement.updatedAt.toISOString(),
  };
}
