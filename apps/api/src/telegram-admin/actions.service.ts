import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type TelegramAdmin } from '@prisma/client';
import { parseStockImport, telegramAdminAllows } from '@webcatt/shared';
import { AdminService } from '../admin/admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CustomersService } from '../customers/customers.service';
import { CouponsService } from '../coupons/coupons.service';
import { AnnouncementService } from '../announcement/announcement.service';
import { LegalService } from '../legal/legal.service';
import { AuditService } from '../audit/audit.service';
import { K } from '../i18n/messages';
import { telegramActor } from './access.service';
import { command, validateCommand, type AdminCommandKind } from './commands';
import type { CreateProductDto } from '../admin/dto/create-product.dto';
import type { UpdateProductDto } from '../admin/dto/update-product.dto';
import type { CreateVariantDto } from '../admin/dto/create-variant.dto';
import type { UpdateVariantDto } from '../admin/dto/update-variant.dto';
import type {
  CreateCouponDto,
  UpdateCouponDto,
} from '../coupons/dto/coupon-admin.dto';
import type { UpdateAnnouncementDto } from '../announcement/dto/update-announcement.dto';
import type { UpdateLegalPageDto } from '../legal/dto/update-legal-page.dto';
import type { UpdateTelegramSettingsDto } from '../settings/dto/update-telegram-settings.dto';

export const ACTION_TTL_MS = 5 * 60_000;
export function payloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export interface PreparedAction {
  id: string;
  kind: AdminCommandKind;
  targetId: string;
  targetCode: string;
  payload: Record<string, unknown>;
  expected: string;
}
export interface AdminActionResult {
  state: 'done' | 'processing';
  file?: { name: string; text: string };
  summary?: string;
}

@Injectable()
export class TelegramAdminActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
    private readonly customers: CustomersService,
    private readonly coupons: CouponsService,
    private readonly announcements: AnnouncementService,
    private readonly legal: LegalService,
    private readonly audit: AuditService,
  ) {}

  async receipt(actor: TelegramAdmin, id: string): Promise<AdminActionResult> {
    const action = await this.prisma.telegramAdminAction.findUnique({
      where: { id },
    });
    if (
      !action ||
      action.telegramUserId !== actor.telegramUserId ||
      !telegramAdminAllows(
        actor.permission,
        command(action.kind)?.permission ?? 'FULL',
      )
    )
      throw new ForbiddenException(K.forbidden);
    if (action.status !== 'DONE') return { state: 'processing' };
    return this.result(action.id, action.kind, action.result);
  }

  async snapshot(
    kind: string,
    target: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{
    hash: string;
    label: string;
    current: Record<string, unknown>;
  }> {
    let row: Record<string, unknown> | null = null;
    const group = kind.split('.')[0];
    if (kind === 'product.create' || kind === 'coupon.create')
      row = { id: 'NEW' };
    else if (group === 'product' || kind === 'variant.create')
      row = await db.product.findUnique({
        where: { id: target },
        select: {
          id: true,
          name: true,
          slug: true,
          updatedAt: true,
          active: true,
          description: true,
          shortDescription: true,
          category: true,
          sortOrder: true,
        },
      });
    else if (
      group === 'variant' ||
      kind === 'stock.import' ||
      kind === 'stock.withdraw'
    )
      row = await db.productVariant.findUnique({
        where: { id: target },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          priceAmount: true,
          priceCurrency: true,
          active: true,
          sortOrder: true,
        },
      });
    else if (group === 'stock')
      row = await db.stockItem.findUnique({
        where: { id: target },
        select: { id: true, status: true },
      });
    else if (group === 'order')
      row = await db.order.findUnique({
        where: { code: target },
        select: {
          id: true,
          code: true,
          status: true,
          totalAmount: true,
          paidAt: true,
        },
      });
    else if (group === 'customer')
      row = await db.user.findUnique({
        where: { id: target },
        select: {
          id: true,
          code: true,
          email: true,
          role: true,
          lockedAt: true,
          passwordChangedAt: true,
        },
      });
    else if (group === 'coupon')
      row = await db.coupon.findUnique({ where: { id: target } });
    else if (group === 'announcement')
      row = (await db.announcement.findUnique({ where: { id: 'main' } })) ?? {
        id: 'main',
      };
    else if (group === 'legal')
      row = (await db.legalPage.findUnique({ where: { slug: target } })) ?? {
        id: target,
      };
    else if (group === 'settings') {
      const setting = await db.storeSetting.findUnique({
        where: { id: 'main' },
      });
      row = setting ? { updatedAt: setting.updatedAt } : null;
    }
    if (!row) throw new BadRequestException(K.orderNotFound);
    if (kind === 'stock.import' || kind === 'stock.withdraw')
      row.availableStock = await db.stockItem.count({
        where: { variantId: target, status: 'AVAILABLE' },
      });
    const label = String(
      row.code ?? row.slug ?? (group === 'settings' ? 'main' : target),
    );
    return { hash: payloadHash(row), label, current: row };
  }

  async prepare(
    actor: TelegramAdmin,
    kind: AdminCommandKind,
    targetId: string,
    payload: Record<string, unknown>,
    expected: string,
    targetCode: string,
  ): Promise<PreparedAction> {
    const spec = command(kind)!;
    if (!telegramAdminAllows(actor.permission, spec.permission))
      throw new ForbiddenException(K.forbidden);
    validateCommand(kind, payload);
    if (kind === 'stock.import') {
      if (
        typeof payload.content !== 'string' ||
        Buffer.byteLength(payload.content) > 1_000_000
      )
        throw new BadRequestException(K.adminStockContentInvalid);
      const items = parseStockImport(payload.content).items;
      if (!items.length || items.length > 1000)
        throw new BadRequestException(K.adminStockContentInvalid);
      payload = { content: items.join('\n') };
    }
    const id = randomBytes(16).toString('hex');
    await this.prisma.telegramAdminAction.create({
      data: {
        id,
        telegramUserId: actor.telegramUserId,
        adminVersion: actor.version,
        kind,
        targetId,
        payloadHash: payloadHash(payload),
        expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      },
    });
    return { id, kind, targetId, payload, expected, targetCode };
  }

  async execute(
    actor: TelegramAdmin,
    action: PreparedAction,
  ): Promise<AdminActionResult> {
    const spec = command(action.kind)!;
    const actorContext = telegramActor(actor);
    const atomicStock = action.kind.startsWith('stock.');
    const gate = await this.prisma.$transaction(
      async (tx) => {
        // Quyền không bị thu hồi giữa kiểm tra và commit nhập/rút kho.
        await tx.$queryRaw`SELECT id FROM "StoreSetting" WHERE id = 'main' FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "TelegramAdmin" WHERE id = ${actor.id} FOR SHARE`;
        const [setting, allowed] = await Promise.all([
          tx.storeSetting.findUnique({ where: { id: 'main' } }),
          tx.telegramAdmin.findUnique({ where: { id: actor.id } }),
        ]);
        if (
          !setting?.telegramAdminEnabled ||
          !allowed?.enabled ||
          allowed.version !== actor.version ||
          !telegramAdminAllows(allowed.permission, spec.permission)
        )
          throw new ForbiddenException(K.forbidden);
        await tx.$queryRaw`SELECT id FROM "TelegramAdminAction" WHERE id = ${action.id} FOR UPDATE`;
        const saved = await tx.telegramAdminAction.findUnique({
          where: { id: action.id },
        });
        if (
          !saved ||
          saved.telegramUserId !== actor.telegramUserId ||
          saved.adminVersion !== actor.version ||
          saved.kind !== action.kind ||
          saved.targetId !== action.targetId ||
          saved.payloadHash !== payloadHash(action.payload) ||
          saved.expiresAt.getTime() < Date.now()
        )
          throw new BadRequestException(K.sessionInvalid);
        if (saved.status !== 'PENDING') return { replay: true, saved };
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${action.targetId}, 7451))::text`;
        const busy = await tx.telegramAdminAction.findFirst({
          where: {
            targetId: action.targetId,
            id: { not: action.id },
            status: { in: ['RUNNING', 'REVIEW'] },
          },
        });
        if (busy) throw new ConflictException(K.adminStorefrontVersionConflict);
        if (
          (await this.snapshot(action.kind, action.targetId, tx)).hash !==
          action.expected
        )
          throw new ConflictException(K.adminStorefrontVersionConflict);
        if (atomicStock) {
          let result: Prisma.InputJsonObject;
          if (action.kind === 'stock.import') {
            const imported = await this.admin.addStock(
              actorContext,
              action.targetId,
              { content: String(action.payload.content), dedupe: true },
              tx,
            );
            result = { ...imported };
          } else if (action.kind === 'stock.withdraw') {
            const withdrawn = await this.admin.withdrawStock(
              actorContext,
              action.targetId,
              {
                quantity: Number(action.payload.quantity),
                mode:
                  action.payload.mode === 'RANDOM' ? 'RANDOM' : 'SEQUENTIAL',
              },
              tx,
            );
            result = {
              ids: withdrawn.lines.map((row) => row.id),
              withdrawn: withdrawn.withdrawn,
              remaining: withdrawn.remaining,
            };
          } else if (action.kind === 'stock.restore') {
            await this.admin.restoreStock(actorContext, action.targetId, tx);
            result = { count: 1 };
          } else {
            await this.admin.deleteStockItem(actorContext, action.targetId, tx);
            result = { count: 1 };
          }
          const updated = await tx.telegramAdminAction.update({
            where: { id: action.id },
            data: { status: 'DONE', result },
          });
          await tx.auditLog.create({
            data: {
              actorId: null,
              actorEmail: '',
              actorCode: 0,
              actorSource: 'TELEGRAM',
              telegramUserId: actor.telegramUserId,
              telegramName: actor.name,
              action:
                action.kind === 'stock.import' ? 'stock.add' : action.kind,
              entityType:
                action.kind === 'stock.restore' ||
                action.kind === 'stock.delete'
                  ? 'stock'
                  : 'variant',
              entityId: action.targetId,
              details: {
                actionId: action.id,
                count: result.added ?? result.withdrawn ?? result.count,
              },
            },
          });
          return { replay: false, saved: updated };
        }
        const updated = await tx.telegramAdminAction.update({
          where: { id: action.id },
          data: { status: 'RUNNING' },
        });
        return { replay: false, saved: updated };
      },
      { timeout: 15000 },
    );
    if (gate.saved.status === 'DONE')
      return this.result(action.id, action.kind, gate.saved.result);
    if (gate.replay) return { state: 'processing' };

    // Lệnh không nguyên tử toàn phần có RUNNING bền vững: mất kết nối sau khi
    // service commit không được phép retry mutation một cách mù quáng.
    try {
      const result = await this.perform(actor, action);
      await this.prisma.telegramAdminAction.update({
        where: { id: action.id },
        data: { status: 'DONE', result: { summary: result.summary ?? '' } },
      });
      return { state: 'done', ...result };
    } catch (err) {
      await this.prisma.telegramAdminAction.updateMany({
        where: { id: action.id, status: 'RUNNING' },
        data: { status: 'REVIEW' },
      });
      await this.audit.log(
        actorContext,
        'settings.update',
        { type: 'telegram-action', id: action.id },
        { kind: action.kind, outcome: 'review' },
      );
      throw err;
    }
  }

  private async result(
    id: string,
    kind: string,
    raw: Prisma.JsonValue,
  ): Promise<AdminActionResult> {
    const result = raw as {
      ids?: string[];
      added?: number;
      skipped?: number;
      total?: number;
      summary?: string;
    } | null;
    if (kind === 'stock.withdraw' && result?.ids) {
      const rows = await this.prisma.stockItem.findMany({
        where: { id: { in: result.ids }, status: 'WITHDRAWN' },
        select: { id: true, content: true },
      });
      const lookup = new Map(rows.map((row) => [row.id, row.content]));
      return {
        state: 'done',
        file: {
          name: `withdraw-${id}.txt`,
          text: result.ids
            .filter((key) => lookup.has(key))
            .map((key) => lookup.get(key))
            .join('\n'),
        },
      };
    }
    return {
      state: 'done',
      summary:
        kind === 'stock.import' ? JSON.stringify(result) : result?.summary,
    };
  }

  private async perform(
    actor: TelegramAdmin,
    a: PreparedAction,
  ): Promise<Omit<AdminActionResult, 'state'>> {
    const user = telegramActor(actor),
      data = a.payload,
      target = a.targetId;
    if (a.kind.startsWith('customer.')) {
      const customer = await this.customers.getOne(target);
      if (customer.role !== 'USER')
        throw new ForbiddenException(K.cannotModifySuperadmin);
      const targetUser = await this.prisma.user.findUnique({
        where: { id: target },
        select: { telegramChatId: true },
      });
      if (targetUser?.telegramChatId === actor.telegramUserId)
        throw new ForbiddenException(K.cannotLockSelf);
    }
    switch (a.kind) {
      case 'product.create':
        await this.admin.createProduct(
          user,
          data as unknown as CreateProductDto,
        );
        break;
      case 'product.edit':
        await this.admin.updateProduct(user, target, data as UpdateProductDto);
        break;
      case 'product.delete':
        await this.admin.deleteProduct(user, target);
        break;
      case 'product.translate':
        await this.admin.translateProduct(user, target);
        break;
      case 'variant.create':
        await this.admin.createVariant(
          user,
          target,
          data as unknown as CreateVariantDto,
        );
        break;
      case 'variant.edit':
        await this.admin.updateVariant(user, target, data as UpdateVariantDto);
        break;
      case 'variant.delete':
        await this.admin.deleteVariant(user, target);
        break;
      case 'stock.restore':
        await this.admin.restoreStock(user, target);
        break;
      case 'stock.delete':
        await this.admin.deleteStockItem(user, target);
        break;
      case 'order.cancel':
        await this.admin.cancelOrder(user, target);
        break;
      case 'order.redeliver':
        await this.admin.redeliverOrder(user, target);
        break;
      case 'order.markPaid':
        await this.admin.markOrderPaid(user, target, String(data.note));
        break;
      case 'customer.lock':
        await this.customers.lock(user, target);
        break;
      case 'customer.unlock':
        await this.customers.unlock(user, target);
        break;
      case 'customer.reset': {
        const result = await this.customers.resetPassword(user, target);
        return {
          file: { name: 'customer-password.txt', text: result.password },
        };
      }
      case 'coupon.create':
        await this.coupons.create(user, data as unknown as CreateCouponDto);
        break;
      case 'coupon.edit':
        await this.coupons.update(user, target, data as UpdateCouponDto);
        break;
      case 'coupon.delete':
        await this.coupons.remove(user, target);
        break;
      case 'announcement.edit':
        await this.announcements.update(
          user,
          data as unknown as UpdateAnnouncementDto,
        );
        break;
      case 'announcement.translate':
        await this.announcements.translate(user);
        break;
      case 'legal.edit':
        await this.legal.update(
          user,
          target,
          data as unknown as UpdateLegalPageDto,
        );
        break;
      case 'settings.alerts':
        await this.settings.updateTelegram(
          user,
          data as UpdateTelegramSettingsDto,
        );
        break;
      default:
        if (a.kind.startsWith('settings.'))
          await this.settings.updateSection(user, data);
        else throw new BadRequestException(K.forbidden);
    }
    return {};
  }
}
