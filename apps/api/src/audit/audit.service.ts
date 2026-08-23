import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import type { AuditAction, AuditLogDto, Paginated } from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';

const DEFAULT_AUDIT_PAGE_SIZE = 50;

/** Thực thể mà thao tác tác động tới (hiển thị/fallback ở trang nhật ký). */
export interface AuditEntity {
  type: string;
  id: string;
}

/**
 * Nhật ký thao tác quản trị. `log` KHÔNG BAO GIỜ ném lỗi — ghi nhật ký
 * thất bại không được làm hỏng thao tác chính của quản trị viên.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    actor: User,
    action: AuditAction,
    entity?: AuditEntity,
    details?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: actor.id,
          // Actor là admin đăng nhập web nên luôn có email; `?? ''` chỉ để
          // thoả cột snapshot NOT NULL từ khi cột email cho phép null.
          actorEmail: actor.email ?? '',
          actorCode: actor.code,
          action,
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
          details:
            details === undefined
              ? Prisma.DbNull
              : (details as Prisma.InputJsonObject),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Không ghi được nhật ký "${action}" (actor ${actor.email}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Danh sách nhật ký, mới nhất trước, lọc theo hành động (tùy chọn). */
  async list(query: AuditQueryDto): Promise<Paginated<AuditLogDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_AUDIT_PAGE_SIZE;
    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const items: AuditLogDto[] = rows.map((row) => ({
      id: row.id,
      actorEmail: row.actorEmail,
      actorCode: row.actorCode,
      action: row.action as AuditAction,
      entityType: row.entityType,
      entityId: row.entityId,
      details:
        row.details === null
          ? null
          : (row.details as Record<string, unknown>),
      createdAt: row.createdAt.toISOString(),
    }));
    return { items, total };
  }
}
