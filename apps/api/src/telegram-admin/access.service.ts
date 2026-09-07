import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TelegramAdmin, User } from '@prisma/client';
import {
  TELEGRAM_ADMIN_PERMISSIONS,
  validTelegramAdminId,
  type TelegramAdminSettingsDto,
  type TelegramAdminDto,
  type TelegramAdminPermission,
} from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminActor } from '../audit/admin-actor';
import { K } from '../i18n/messages';

export function telegramActor(admin: TelegramAdmin): AdminActor {
  return {
    id: null,
    email: null,
    code: 0,
    role: 'ADMIN',
    telegramUserId: admin.telegramUserId,
    telegramName: admin.name,
  };
}

@Injectable()
export class TelegramAdminAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async resolve(id: number): Promise<TelegramAdmin | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const setting = await this.prisma.storeSetting.findUnique({
      where: { id: 'main' },
      select: { telegramAdminEnabled: true },
    });
    if (!setting?.telegramAdminEnabled) return null;
    return this.prisma.telegramAdmin.findFirst({
      where: { telegramUserId: String(id), enabled: true },
    });
  }

  async list(): Promise<TelegramAdminSettingsDto> {
    const [setting, admins, pendingActions] = await Promise.all([
      this.prisma.storeSetting.findUnique({
        where: { id: 'main' },
        select: { telegramAdminEnabled: true },
      }),
      this.prisma.telegramAdmin.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.telegramAdminAction.findMany({
        where: {
          OR: [
            { status: 'REVIEW' },
            {
              status: 'RUNNING',
              updatedAt: { lt: new Date(Date.now() - 30 * 60_000) },
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          telegramUserId: true,
          kind: true,
          targetId: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      enabled: setting?.telegramAdminEnabled ?? false,
      admins: admins.map(toDto),
      pendingActions: pendingActions.map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async enable(actor: User, enabled: boolean) {
    this.owner(actor);
    if (typeof enabled !== 'boolean')
      throw new BadRequestException(K.adminSettingsFlagInvalid);
    await this.prisma.$transaction(async (tx) => {
      await tx.storeSetting.upsert({
        where: { id: 'main' },
        create: { id: 'main', telegramAdminEnabled: enabled },
        update: { telegramAdminEnabled: enabled },
      });
      // Tắt rồi bật lại không được hồi sinh những nút xác nhận cũ.
      await tx.telegramAdmin.updateMany({
        data: { version: { increment: 1 } },
      });
      await tx.telegramAdminAction.updateMany({
        where: { status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    });
    await this.audit.log(
      actor,
      'settings.update',
      { type: 'telegram-admin', id: 'enabled' },
      { enabled },
    );
    return this.list();
  }

  async save(
    actor: User,
    input: {
      telegramUserId: string;
      name: string;
      permission: TelegramAdminPermission;
      enabled: boolean;
      version?: number;
    },
    id?: string,
  ) {
    this.owner(actor);
    if (
      typeof input.telegramUserId !== 'string' ||
      !validTelegramAdminId(input.telegramUserId) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      !TELEGRAM_ADMIN_PERMISSIONS.includes(input.permission) ||
      typeof input.enabled !== 'boolean'
    )
      throw new BadRequestException(K.adminTelegramOwnerChatInvalid);
    if (id) {
      const current = await this.prisma.telegramAdmin.findUnique({
        where: { id },
      });
      if (!current) throw new NotFoundException(K.customerNotFound);
      if (input.telegramUserId !== current.telegramUserId)
        throw new BadRequestException(K.adminTelegramOwnerChatInvalid);
      const gate = await this.prisma.telegramAdmin.updateMany({
        where: { id, version: input.version ?? -1 },
        data: {
          name: input.name.trim(),
          permission: input.permission,
          enabled: input.enabled,
          version: { increment: 1 },
        },
      });
      if (!gate.count)
        throw new ConflictException(K.adminStorefrontVersionConflict);
    } else {
      if ((await this.prisma.telegramAdmin.count()) >= 50)
        throw new BadRequestException(K.adminTelegramOwnerNumberInvalid);
      try {
        await this.prisma.telegramAdmin.create({
          data: {
            telegramUserId: input.telegramUserId,
            name: input.name.trim(),
            permission: input.permission,
            enabled: input.enabled,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002')
          throw new ConflictException(K.emailTaken);
        throw err;
      }
    }
    await this.audit.log(
      actor,
      'settings.update',
      { type: 'telegram-admin', id: input.telegramUserId },
      {
        permission: input.permission,
        enabled: input.enabled,
        name: input.name,
      },
    );
    return this.list();
  }

  async remove(actor: User, id: string) {
    this.owner(actor);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.telegramAdmin.findUnique({ where: { id } });
      if (!row) throw new NotFoundException(K.customerNotFound);
      await tx.telegramAdmin.delete({ where: { id } });
      await tx.telegramAdminAction.updateMany({
        where: { telegramUserId: row.telegramUserId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    });
    await this.audit.log(
      actor,
      'settings.update',
      { type: 'telegram-admin', id },
      { removed: true },
    );
    return this.list();
  }

  async acknowledge(actor: User, id: string) {
    this.owner(actor);
    const gate = await this.prisma.telegramAdminAction.updateMany({
      where: {
        id,
        OR: [
          { status: 'REVIEW' },
          {
            status: 'RUNNING',
            updatedAt: { lt: new Date(Date.now() - 30 * 60_000) },
          },
        ],
      },
      data: { status: 'ACKNOWLEDGED' },
    });
    if (!gate.count)
      throw new ConflictException(K.adminStorefrontVersionConflict);
    await this.audit.log(
      actor,
      'settings.update',
      { type: 'telegram-action', id },
      { outcome: 'acknowledged' },
    );
    return this.list();
  }

  private owner(actor: User) {
    if (actor.role !== 'SUPERADMIN' || actor.lockedAt)
      throw new ForbiddenException(K.superadminRequired);
  }
}

function toDto(row: TelegramAdmin): TelegramAdminDto {
  return {
    id: row.id,
    telegramUserId: row.telegramUserId,
    name: row.name,
    permission: row.permission,
    enabled: row.enabled,
    version: row.version,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}
