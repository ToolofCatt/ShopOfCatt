import { BadRequestException, Injectable } from '@nestjs/common';
import type { LegalPage, User } from '@prisma/client';
import {
  LEGAL_PAGE_SLUGS,
  isLegalPageSlug,
  type LegalPageDto,
  type LegalPageSlug,
} from '@webcatt/shared';
import { sanitizeAnnouncementHtml } from '../announcement/sanitize-announcement';
import { AuditService } from '../audit/audit.service';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateLegalPageDto } from './dto/update-legal-page.dto';

/**
 * Trang chính sách cửa hàng. Nội dung do quản trị viên soạn bằng cùng trình
 * soạn thảo với hộp thông báo, và đi qua ĐÚNG bộ lọc HTML đó — không có đường
 * nào đưa thẻ lạ vào trang công khai.
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Một trang cho khách xem. Chưa soạn thì trả về nội dung rỗng, không 404. */
  async getPublic(slug: string): Promise<LegalPageDto> {
    if (!isLegalPageSlug(slug)) {
      throw new BadRequestException(K.legalSlugInvalid);
    }
    const page = await this.prisma.legalPage.findUnique({ where: { slug } });
    return page ? toDto(page) : emptyPage(slug);
  }

  /** Cả ba trang cho trang quản trị. */
  async listAdmin(): Promise<LegalPageDto[]> {
    const pages = await this.prisma.legalPage.findMany();
    const bySlug = new Map(pages.map((p) => [p.slug, p]));
    return LEGAL_PAGE_SLUGS.map((slug) => {
      const page = bySlug.get(slug);
      return page ? toDto(page) : emptyPage(slug);
    });
  }

  async update(
    actor: User,
    slug: string,
    dto: UpdateLegalPageDto,
  ): Promise<LegalPageDto> {
    if (!isLegalPageSlug(slug)) {
      throw new BadRequestException(K.legalSlugInvalid);
    }
    const data = {
      title: dto.title.trim(),
      body: sanitizeAnnouncementHtml(dto.body),
    };
    const saved = await this.prisma.legalPage.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    await this.audit.log(
      actor,
      'legal.update',
      { type: 'legal', id: slug },
      { slug },
    );
    return toDto(saved);
  }
}

function toDto(page: LegalPage): LegalPageDto {
  return {
    slug: page.slug as LegalPageSlug,
    title: page.title,
    body: page.body,
    updatedAt: page.updatedAt.toISOString(),
  };
}

function emptyPage(slug: LegalPageSlug): LegalPageDto {
  return { slug, title: '', body: '', updatedAt: new Date(0).toISOString() };
}
