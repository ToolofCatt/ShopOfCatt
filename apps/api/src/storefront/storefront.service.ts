import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type User } from '@prisma/client';
import {
  STOREFRONT_REVISION_LIMIT,
  createDefaultStorefrontDocument,
  parseStorefrontDocument,
  type PublicStorefrontDto,
  type StoreMediaAssetDto,
  type StorefrontBlock,
  type StorefrontDocument,
  type StorefrontDraftDto,
  type StorefrontRevisionDto,
} from '@webcatt/shared';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { sanitizeAnnouncementHtml } from '../announcement/sanitize-announcement';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import { decodeStoreMedia } from './media-image';

const SETUP_ID = 'main';
const DRAFT_ID = 'main';

@Injectable()
export class StorefrontService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private defaultDocument(): StorefrontDocument {
    const name = (this.config.get<string>('STORE_BOOTSTRAP_NAME') ?? 'Digital Store').trim();
    return createDefaultStorefrontDocument(name || 'Digital Store');
  }

  async ensureSetup() {
    return this.prisma.storeSetup.upsert({
      where: { id: SETUP_ID },
      create: { id: SETUP_ID },
      update: {},
    });
  }

  async getDraft(): Promise<StorefrontDraftDto> {
    const draft = await this.prisma.storefrontDraft.upsert({
      where: { id: DRAFT_ID },
      create: {
        id: DRAFT_ID,
        document: this.defaultDocument() as unknown as Prisma.InputJsonValue,
      },
      update: {},
    });
    return {
      document: parseStorefrontDocument(draft.document),
      version: draft.version,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async updateDraft(
    actor: User,
    expectedVersion: number,
    rawDocument: unknown,
  ): Promise<StorefrontDraftDto> {
    let document: StorefrontDocument;
    try {
      document = sanitizeDocument(parseStorefrontDocument(rawDocument));
    } catch {
      throw new BadRequestException(K.adminStorefrontInvalid);
    }
    await this.getDraft();
    const draft = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.storefrontDraft.updateMany({
        where: { id: DRAFT_ID, version: expectedVersion },
        data: {
          document: document as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedById: actor.id,
        },
      });
      if (updated.count !== 1) throw new ConflictException(K.adminStorefrontVersionConflict);
      // UPDATE giữ row lock tới lúc transaction kết thúc, nên tab khác không thể
      // chen một version mới giữa lần ghi này và phản hồi trả về cho editor.
      return tx.storefrontDraft.findUniqueOrThrow({ where: { id: DRAFT_ID } });
    });
    await this.audit.log(actor, 'storefront.draft.update', { type: 'storefront', id: DRAFT_ID }, { version: draft.version });
    return {
      document: parseStorefrontDocument(draft.document),
      version: draft.version,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async getPublic(): Promise<PublicStorefrontDto> {
    const setup = await this.ensureSetup();
    if (!setup.publishedAt) {
      return {
        published: false,
        maintenanceMode: true,
        document: this.defaultDocument(),
        revision: 0,
      };
    }
    const revision = setup.publishedRevisionId
      ? await this.prisma.storefrontRevision.findUnique({ where: { id: setup.publishedRevisionId } })
      : await this.bootstrapPublishedRevision(setup.publishedAt);
    return {
      published: true,
      maintenanceMode: setup.maintenanceMode,
      document: revision ? parseStorefrontDocument(revision.document) : this.defaultDocument(),
      revision: revision?.version ?? 0,
    };
  }

  /** Bản cài cũ được migration đánh dấu published; lần đọc đầu chụp giao diện cũ thành revision. */
  private async bootstrapPublishedRevision(publishedAt: Date) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(73194620)`;
      const setup = await tx.storeSetup.findUniqueOrThrow({ where: { id: SETUP_ID } });
      if (setup.publishedRevisionId) {
        return tx.storefrontRevision.findUnique({ where: { id: setup.publishedRevisionId } });
      }
      const existing = await tx.storefrontRevision.findUnique({ where: { version: 1 } });
      const revision = existing ?? await tx.storefrontRevision.create({
        data: {
          version: 1,
          document: this.defaultDocument() as unknown as Prisma.InputJsonValue,
          publishedBy: 'migration',
          publishedAt,
        },
      });
      await tx.storeSetup.update({
        where: { id: SETUP_ID },
        data: { publishedRevisionId: revision.id },
      });
      return revision;
    });
  }

  async publish(actor: User, documentOverride?: StorefrontDocument): Promise<PublicStorefrontDto> {
    const draft = documentOverride ?? (await this.getDraft()).document;
    const document = sanitizeDocument(parseStorefrontDocument(draft));
    const revision = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(73194620)`;
      const latest = await tx.storefrontRevision.aggregate({ _max: { version: true } });
      const created = await tx.storefrontRevision.create({
        data: {
          version: (latest._max.version ?? 0) + 1,
          document: document as unknown as Prisma.InputJsonValue,
          publishedById: actor.id,
          publishedBy: actor.email ?? `#${actor.code}`,
        },
      });
      await tx.storeSetup.upsert({
        where: { id: SETUP_ID },
        create: {
          id: SETUP_ID,
          publishedAt: created.publishedAt,
          publishedRevisionId: created.id,
          currentStep: 'review',
        },
        update: {
          publishedAt: created.publishedAt,
          publishedRevisionId: created.id,
          maintenanceMode: false,
          currentStep: 'review',
        },
      });
      const old = await tx.storefrontRevision.findMany({
        orderBy: { version: 'desc' },
        skip: STOREFRONT_REVISION_LIMIT,
        select: { id: true },
      });
      if (old.length > 0) await tx.storefrontRevision.deleteMany({ where: { id: { in: old.map((row) => row.id) } } });
      return created;
    });
    await this.audit.log(actor, 'storefront.publish', { type: 'storefront', id: revision.id }, { version: revision.version });
    return {
      published: true,
      maintenanceMode: false,
      document,
      revision: revision.version,
    };
  }

  async revisions(limit = STOREFRONT_REVISION_LIMIT): Promise<StorefrontRevisionDto[]> {
    const rows = await this.prisma.storefrontRevision.findMany({
      orderBy: { version: 'desc' },
      take: Math.min(limit, STOREFRONT_REVISION_LIMIT),
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: row.publishedBy,
    }));
  }

  async restore(actor: User, id: string): Promise<PublicStorefrontDto> {
    const revision = await this.prisma.storefrontRevision.findUnique({ where: { id } });
    if (!revision) throw new NotFoundException(K.adminStorefrontRevisionNotFound);
    const document = parseStorefrontDocument(revision.document);
    const draft = await this.getDraft();
    await this.updateDraft(actor, draft.version, document);
    const result = await this.publish(actor, document);
    await this.audit.log(actor, 'storefront.restore', { type: 'storefront', id }, { fromVersion: revision.version, toVersion: result.revision });
    return result;
  }

  async setMaintenance(actor: User, enabled: boolean): Promise<{ maintenanceMode: boolean }> {
    const setup = await this.ensureSetup();
    if (!setup.publishedAt && !enabled) throw new BadRequestException(K.adminStorefrontPublishBlocked);
    const updated = await this.prisma.storeSetup.update({
      where: { id: SETUP_ID },
      data: { maintenanceMode: enabled },
    });
    await this.audit.log(actor, 'storefront.maintenance', { type: 'storefront', id: SETUP_ID }, { enabled });
    return { maintenanceMode: updated.maintenanceMode };
  }

  async addMedia(actor: User, raw: string): Promise<StoreMediaAssetDto> {
    const decoded = decodeStoreMedia(raw);
    if (!decoded) {
      if (raw.length > 1_350_000) throw new BadRequestException(K.adminStorefrontMediaTooLarge);
      throw new BadRequestException(K.adminStorefrontMediaInvalid);
    }
    const created = await this.prisma.storeMediaAsset.create({
      data: {
        contentType: decoded.contentType,
        data: Uint8Array.from(decoded.data),
        bytes: decoded.data.length,
        width: decoded.width,
        height: decoded.height,
        sha256: createHash('sha256').update(decoded.data).digest('hex'),
      },
    });
    await this.audit.log(actor, 'storefront.media.add', { type: 'storefront-media', id: created.id }, { bytes: created.bytes, contentType: created.contentType });
    return this.mediaDto(created);
  }

  async listMedia(): Promise<StoreMediaAssetDto[]> {
    const rows = await this.prisma.storeMediaAsset.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, contentType: true, bytes: true, width: true, height: true, createdAt: true },
    });
    return rows.map((row) => this.mediaDto(row));
  }

  async getMedia(id: string) {
    const media = await this.prisma.storeMediaAsset.findUnique({ where: { id } });
    if (!media) throw new NotFoundException(K.adminStorefrontMediaNotFound);
    return media;
  }

  async deleteMedia(actor: User, id: string): Promise<{ success: true }> {
    const media = await this.prisma.storeMediaAsset.findUnique({ where: { id }, select: { id: true } });
    if (!media) throw new NotFoundException(K.adminStorefrontMediaNotFound);
    const [draft, revisions] = await Promise.all([
      this.prisma.storefrontDraft.findUnique({ where: { id: DRAFT_ID }, select: { document: true } }),
      this.prisma.storefrontRevision.findMany({ select: { document: true } }),
    ]);
    if ([draft?.document, ...revisions.map((row) => row.document)].some((document) => JSON.stringify(document).includes(id))) {
      throw new ConflictException(K.adminStorefrontMediaInUse);
    }
    await this.prisma.storeMediaAsset.delete({ where: { id } });
    await this.audit.log(actor, 'storefront.media.delete', { type: 'storefront-media', id });
    return { success: true };
  }

  private mediaDto(row: MediaRow): StoreMediaAssetDto {
    const publicOrigin = (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3001').replace(/\/$/, '');
    return {
      id: row.id,
      contentType: row.contentType as StoreMediaAssetDto['contentType'],
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      // Builder chạy tách cổng web/API ở máy dev; URL tuyệt đối tránh ảnh bị Next.js bắt nhầm thành route web.
      url: `${publicOrigin}/api/storefront/media/${row.id}`,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

type MediaRow = { id: string; contentType: string; bytes: number; width: number; height: number; createdAt: Date };

function sanitizeDocument(document: StorefrontDocument): StorefrontDocument {
  const cleanBlock = (block: StorefrontBlock): StorefrontBlock => {
    const props = { ...block.props };
    if (block.type === 'richText') {
      // Builder lưu `html` theo object {vi,en,zh}; chỉ lọc nhánh string như bản
      // cũ sẽ để script nguyên vẹn trong snapshot đa ngôn ngữ.
      props.html = sanitizeRichTextValue(props.html);
      for (const key of ['vi', 'en', 'zh']) if (props[key] !== undefined) props[key] = sanitizeRichTextValue(props[key]);
    }
    return {
      ...block,
      props,
      ...(block.children ? { children: block.children.map(cleanBlock) } : {}),
    };
  };
  return {
    ...document,
    brand: {
      ...document.brand,
      name: document.brand.name.trim(),
      shortName: document.brand.shortName.trim(),
    },
    pages: Object.fromEntries(
      Object.entries(document.pages).map(([kind, page]) => [kind, { ...page, blocks: page.blocks.map(cleanBlock) }]),
    ) as StorefrontDocument['pages'],
  };
}

function sanitizeRichTextValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeAnnouncementHtml(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([locale, html]) => [locale, typeof html === 'string' ? sanitizeAnnouncementHtml(html) : '']),
  );
}
