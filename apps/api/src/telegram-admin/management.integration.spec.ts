import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, type TelegramAdmin, type User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminService } from '../admin/admin.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import { CustomersService } from '../customers/customers.service';
import { TelegramAdminAccessService } from './access.service';
import { TelegramAdminActionsService } from './actions.service';
import type { PrismaService } from '../prisma/prisma.service';

const DB = 'webcatt_telegram_management_test';
const base =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt';
function client(database: string) {
  const url = new URL(base);
  url.pathname = '/' + database;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}
let db: PrismaClient,
  access: TelegramAdminAccessService,
  actions: TelegramAdminActionsService,
  owner: User,
  operator: TelegramAdmin,
  full: TelegramAdmin,
  variantId: string;
let reachable = false;
beforeAll(async () => {
  const admin = client('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    reachable = true;
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DB}"`);
  } catch {
    return;
  } finally {
    await admin.$disconnect();
  }
  db = client(DB);
  const path = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(path).sort()) {
    if (folder === 'migration_lock.toml') continue;
    const sql = readFileSync(join(path, folder, 'migration.sql'), 'utf8');
    for (const statement of sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.$executeRawUnsafe(statement);
  }
  const prisma = db as unknown as PrismaService;
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, new ConfigService({}), audit);
  const fulfillment = new FulfillmentService(prisma);
  const adminService = new AdminService(
    prisma,
    fulfillment,
    { translateProductSafe: async () => {} } as never,
    audit,
    settings,
  );
  access = new TelegramAdminAccessService(prisma, audit);
  actions = new TelegramAdminActionsService(
    prisma,
    adminService,
    settings,
    new CustomersService(prisma, audit),
    {} as never,
    {} as never,
    {} as never,
    audit,
  );
  owner = await db.user.create({
    data: {
      email: 'owner@example.test',
      passwordHash: 'test',
      code: 91004567,
      role: 'SUPERADMIN',
    },
  });
  await settings.getSetting();
  expect((await access.list()).enabled).toBe(false);
  await access.save(owner, {
    telegramUserId: '1234567',
    name: 'Operator',
    permission: 'OPERATOR',
    enabled: true,
  });
  await access.save(owner, {
    telegramUserId: '1234568',
    name: 'Owner',
    permission: 'FULL',
    enabled: true,
  });
  await access.enable(owner, true);
  operator = (await access.resolve(1234567))!;
  full = (await access.resolve(1234568))!;
  const product = await db.product.create({
    data: {
      slug: 'management-test',
      name: 'Test',
      variants: { create: { name: 'Default', price: 2, priceAmount: 2 } },
    },
    include: { variants: true },
  });
  variantId = product.variants[0]!.id;
}, 120000);
afterAll(async () => {
  if (!reachable) return;
  await db?.$disconnect();
  const admin = client('postgres');
  try {
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`,
    );
  } finally {
    await admin.$disconnect();
  }
}, 60000);

describe('Telegram admin transaction (real PostgreSQL)', () => {
  it('does not replay or acknowledge an in-flight action', async (ctx) => {
    if (!reachable) return ctx.skip();
    const saved = await db.telegramAdminAction.create({
      data: {
        id: 'review-fixture',
        telegramUserId: full.telegramUserId,
        adminVersion: full.version,
        kind: 'product.edit',
        targetId: 'review-target',
        payloadHash: 'hash',
        status: 'RUNNING',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await expect(access.acknowledge(owner, saved.id)).rejects.toThrow();
    await db.telegramAdminAction.update({
      where: { id: saved.id },
      data: { status: 'REVIEW' },
    });
    expect((await access.list()).pendingActions.map((a) => a.id)).toContain(
      saved.id,
    );
    await access.acknowledge(owner, saved.id);
    expect(
      (
        await db.telegramAdminAction.findUniqueOrThrow({
          where: { id: saved.id },
        })
      ).status,
    ).toBe('ACKNOWLEDGED');
  });
  it('keeps Telegram admins independent from web identities', async (ctx) => {
    if (!reachable) return ctx.skip();
    expect(await db.user.count()).toBe(1);
    await expect(
      access.save(
        { ...owner, role: 'ADMIN' },
        {
          telegramUserId: '999',
          name: 'Bad',
          permission: 'FULL',
          enabled: true,
        },
      ),
    ).rejects.toThrow();
    expect(await access.resolve(999)).toBeNull();
  });
  it('imports and withdraws exactly once under duplicate concurrent confirmations', async (ctx) => {
    if (!reachable) return ctx.skip();
    const snapshot = await actions.snapshot('stock.import', variantId);
    const action = await actions.prepare(
      operator,
      'stock.import',
      variantId,
      { content: '[ {"key":"A"}, {"key":"B"}, {"key":"C"} ]' },
      snapshot.hash,
      snapshot.label,
    );
    await Promise.all([
      actions.execute(operator, action),
      actions.execute(operator, action),
    ]);
    expect(
      await db.stockItem.count({ where: { variantId, status: 'AVAILABLE' } }),
    ).toBe(3);
    expect(
      await db.auditLog.count({
        where: { actorSource: 'TELEGRAM', action: 'stock.add' },
      }),
    ).toBe(1);
    const snap = await actions.snapshot('stock.withdraw', variantId);
    const take = await actions.prepare(
      full,
      'stock.withdraw',
      variantId,
      { quantity: 2, mode: 'SEQUENTIAL' },
      snap.hash,
      snap.label,
    );
    const results = await Promise.all([
      actions.execute(full, take),
      actions.execute(full, take),
    ]);
    expect(results[0].file?.text).toBe(results[1].file?.text);
    expect(
      await db.stockItem.count({ where: { variantId, status: 'WITHDRAWN' } }),
    ).toBe(2);
    expect(
      await db.stockItem.count({ where: { variantId, status: 'AVAILABLE' } }),
    ).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'stock.withdraw' },
    });
    expect(audit.actorId).toBeNull();
    expect(audit.telegramUserId).toBe(full.telegramUserId);
    expect(JSON.stringify(audit.details)).not.toContain('"key"');
    const stored = await db.telegramAdminAction.findUniqueOrThrow({
      where: { id: take.id },
    });
    expect(JSON.stringify(stored.result)).not.toContain('"key"');
  });
  it('rejects permission escalation, tampering, expired actions, and revoked admins', async (ctx) => {
    if (!reachable) return ctx.skip();
    const snap = await actions.snapshot('stock.withdraw', variantId);
    await expect(
      actions.prepare(
        operator,
        'stock.withdraw',
        variantId,
        { quantity: 1 },
        snap.hash,
        snap.label,
      ),
    ).rejects.toThrow();
    const pending = await actions.prepare(
      operator,
      'stock.import',
      variantId,
      { content: 'KEY-D' },
      snap.hash,
      snap.label,
    );
    await expect(actions.execute(full, pending)).rejects.toThrow();
    await expect(
      actions.execute(operator, {
        ...pending,
        payload: { content: 'KEY-TAMPER' },
      }),
    ).rejects.toThrow();
    await db.telegramAdminAction.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(actions.execute(operator, pending)).rejects.toThrow();
    const revoked = await actions.prepare(
      operator,
      'stock.import',
      variantId,
      { content: 'KEY-E' },
      snap.hash,
      snap.label,
    );
    await access.save(owner, { ...operator, enabled: false }, operator.id);
    await expect(actions.execute(operator, revoked)).rejects.toThrow();
    expect(await access.resolve(Number(operator.telegramUserId))).toBeNull();
    expect(await db.stockItem.count({ where: { variantId } })).toBe(3);
  });
  it('rolls back action receipt with failed inventory transaction', async (ctx) => {
    if (!reachable) return ctx.skip();
    const snap = await actions.snapshot('stock.withdraw', variantId);
    const pending = await actions.prepare(
      full,
      'stock.withdraw',
      variantId,
      { quantity: 1, mode: 'SEQUENTIAL' },
      snap.hash,
      snap.label,
    );
    await db.stockItem.updateMany({
      where: { variantId, status: 'AVAILABLE' },
      data: { status: 'WITHDRAWN' },
    });
    await expect(actions.execute(full, pending)).rejects.toThrow();
    expect(
      (
        await db.telegramAdminAction.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).status,
    ).toBe('PENDING');
  });

  it('deletes only available stock and never records key content in audit', async (ctx) => {
    if (!reachable) return ctx.skip();
    const item = await db.stockItem.create({
      data: { variantId, content: 'PRIVATE-DELETE-FIXTURE' },
    });
    const snap = await actions.snapshot('stock.delete', item.id);
    const action = await actions.prepare(
      full,
      'stock.delete',
      item.id,
      {},
      snap.hash,
      snap.label,
    );
    await Promise.all([
      actions.execute(full, action),
      actions.execute(full, action),
    ]);
    expect(
      await db.stockItem.findUnique({ where: { id: item.id } }),
    ).toBeNull();
    const logs = await db.auditLog.findMany({
      where: { action: 'stock.delete', entityId: item.id },
    });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('PRIVATE-DELETE-FIXTURE');
    const reserved = await db.stockItem.create({
      data: { variantId, content: 'RESERVED-FIXTURE', status: 'RESERVED' },
    });
    const rs = await actions.snapshot('stock.delete', reserved.id);
    const pending = await actions.prepare(
      full,
      'stock.delete',
      reserved.id,
      {},
      rs.hash,
      rs.label,
    );
    await expect(actions.execute(full, pending)).rejects.toThrow();
    expect(
      (await db.stockItem.findUniqueOrThrow({ where: { id: reserved.id } }))
        .status,
    ).toBe('RESERVED');
  });

  it('manual payment confirmation uses fulfillment and never delivers twice', async (ctx) => {
    if (!reachable) return ctx.skip();
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
    });
    await db.stockItem.create({
      data: { variantId, content: 'DELIVERY-FIXTURE' },
    });
    const order = await db.order.create({
      data: {
        code: 'DH-ADMIN1',
        userId: owner.id,
        status: 'PENDING',
        subtotalAmount: 2,
        totalAmount: 2,
        items: {
          create: {
            productId: variant.productId,
            variantId,
            productName: 'Test',
            variantName: 'Default',
            unitPrice: 2,
            quantity: 1,
          },
        },
        payment: {
          create: {
            merchantTradeNo: 'ADMIN-FIXTURE',
            amount: 2,
            mode: 'SEPAY',
            status: 'PENDING',
          },
        },
      },
    });
    const snap = await actions.snapshot('order.markPaid', order.code);
    const action = await actions.prepare(
      full,
      'order.markPaid',
      order.code,
      { note: 'Fixture only' },
      snap.hash,
      snap.label,
    );
    await Promise.all([
      actions.execute(full, action),
      actions.execute(full, action),
    ]);
    expect(
      (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    ).toBe('DELIVERED');
    expect(
      await db.stockItem.count({ where: { variantId, status: 'SOLD' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'order.mark_paid', actorSource: 'TELEGRAM' },
      }),
    ).toBe(1);
  });
});
