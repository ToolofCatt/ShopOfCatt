import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, type StockStatus, type TelegramAdmin, type User } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramAdminActionsService } from '../telegram-admin/actions.service';
import { AdminService } from './admin.service';

const base = process.env.DATABASE_URL;
const database = `stock_hardening_${randomUUID().replaceAll('-', '')}`;
let created = false;
let db: PrismaClient;
let owner: User;
let operator: TelegramAdmin;
let admin: AdminService;
let actions: TelegramAdminActionsService;

function client(name: string): PrismaClient {
  const url = new URL(base!);
  // Không dùng fallback app.env: suite có CREATE/DROP, chỉ nhận cluster synthetic của runner.
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/review') {
    throw new Error('Run stock hardening tests with the isolated run-db-command.mjs runner');
  }
  url.pathname = `/${name}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

function service(connection: PrismaClient = db): AdminService {
  const prisma = connection as unknown as PrismaService;
  const audit = new AuditService(prisma);
  return new AdminService(
    prisma,
    new FulfillmentService(prisma),
    {} as never,
    audit,
    new SettingsService(prisma, new ConfigService({}), audit),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForBlocked(count: number, completed: () => boolean = () => false) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (completed()) return;
    const [{ blocked }] = await db.$queryRaw<Array<{ blocked: bigint }>>`
      SELECT count(*) AS blocked FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (Number(blocked) >= count) return;
  }
  throw new Error(`Expected ${count} blocked transaction(s) at the PostgreSQL barrier`);
}

async function product() {
  return db.product.create({
    data: {
      slug: `stock-test-${randomUUID()}`,
      name: 'TEST stock hardening',
      variants: { create: [
        { name: 'A', price: 2, priceAmount: 2 },
        { name: 'B', price: 2, priceAmount: 2 },
      ] },
    },
    include: { variants: { orderBy: { name: 'asc' } } },
  });
}

async function history(productId: string, variantId: string) {
  return db.order.create({
    data: {
      code: `TEST-${randomUUID()}`,
      userId: owner.id,
      status: 'CANCELLED',
      totalAmount: 2,
      items: { create: {
        productId, variantId, productName: 'TEST snapshot', variantName: 'A', unitPrice: 2, quantity: 1,
      } },
    },
    include: { items: true },
  });
}

beforeAll(async () => {
  if (!base) return;
  const bootstrap = client('postgres');
  try {
    await bootstrap.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
  } finally {
    await bootstrap.$disconnect();
  }
  db = client(database);
  const migrations = resolve(__dirname, '../../prisma/migrations');
  for (const entry of readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = readFileSync(join(migrations, entry.name, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  }
  owner = await db.user.create({
    data: { code: 95001001, email: 'stock-owner@test.local', passwordHash: 'synthetic', role: 'SUPERADMIN' },
  });
  await db.user.create({
    data: { code: 95001002, passwordHash: 'synthetic', telegramChatId: '95001002' },
  });
  await db.storeSetting.create({
    data: {
      id: 'main', telegramAdminEnabled: true, telegramBotEnabled: true,
      telegramBotToken: 'synthetic-token-never-sent', telegramStockAlertsEnabled: true,
    },
  });
  operator = await db.telegramAdmin.create({
    data: { telegramUserId: '95001003', name: 'TEST operator', permission: 'FULL' },
  });
  admin = service();
  actions = new TelegramAdminActionsService(
    db as unknown as PrismaService, admin, {} as never, {} as never,
    {} as never, {} as never, {} as never, new AuditService(db as unknown as PrismaService),
  );
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  if (!created) return;
  const bootstrap = client('postgres');
  try {
    await bootstrap.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
  } finally {
    await bootstrap.$disconnect();
  }
}, 60_000);

describe.skipIf(!base)('stock safety on isolated PostgreSQL', () => {
  it('dedupes two web imports under contention and queues only one alert', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const locked = deferred();
    const release = deferred();
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await locked.promise;
    const results = Promise.all([
      admin.addStock(owner, variantId, { content: 'TEST-KEY', dedupe: true }),
      admin.addStock(owner, variantId, { content: 'TEST-KEY', dedupe: true }),
    ]);
    try {
      await waitForBlocked(2);
    } finally {
      release.resolve();
      await holder;
    }
    expect((await results).map((r) => r.added).sort()).toEqual([0, 1]);
    expect(await db.stockItem.count({ where: { variantId } })).toBe(1);
    expect(await db.telegramStockAlert.count({ where: { productId: p.id } })).toBe(1);
  }, 20_000);

  it('rechecks Telegram snapshot after a concurrent web import commits, without duplicate stock or deadlock', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const snapshot = await actions.snapshot('stock.import', variantId);
    const action = await actions.prepare(operator, 'stock.import', variantId, { content: 'TEST-SAME' }, snapshot.hash, snapshot.label);
    const inserted = deferred();
    const release = deferred();
    const web = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
      await admin.addStock(owner, variantId, { content: 'TEST-SAME', dedupe: true }, tx);
      inserted.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await inserted.promise;
    const bot = actions.execute(operator, action).then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, error }),
    );
    try {
      await waitForBlocked(1);
    } finally {
      release.resolve();
      await web;
    }
    expect(await bot).toMatchObject({ ok: false, error: { message: 'admin.storefront_version_conflict' } });
    expect(await db.stockItem.count({ where: { variantId } })).toBe(1);
    expect(await db.telegramStockAlert.count({ where: { productId: p.id } })).toBe(1);
    expect((await db.telegramAdminAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe('PENDING');
  }, 20_000);

  it('lets a web import queue behind Telegram without a lock-order cycle or duplicate alert', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const snapshot = await actions.snapshot('stock.import', variantId);
    const action = await actions.prepare(operator, 'stock.import', variantId, { content: 'TEST-BOT-FIRST' }, snapshot.hash, snapshot.label);
    const inserted = deferred();
    const release = deferred();
    const hooked = db.$extends({ query: { telegramStockAlert: { async create({ args, query }) {
      const row = await query(args);
      inserted.resolve();
      await release.promise;
      return row;
    } } } });
    const botActions = new TelegramAdminActionsService(
      hooked as unknown as PrismaService, service(hooked as unknown as PrismaClient),
      {} as never, {} as never, {} as never, {} as never, {} as never,
      new AuditService(db as unknown as PrismaService),
    );
    const bot = botActions.execute(operator, action);
    await inserted.promise;
    const web = admin.addStock(owner, variantId, { content: 'TEST-BOT-FIRST', dedupe: true });
    try {
      await waitForBlocked(1);
    } finally {
      release.resolve();
    }
    expect(await bot).toMatchObject({ state: 'done' });
    expect(await web).toEqual({ added: 0, skipped: 1, total: 1 });
    expect(await db.stockItem.count({ where: { variantId } })).toBe(1);
    expect(await db.telegramStockAlert.count({ where: { productId: p.id } })).toBe(1);
  }, 20_000);

  it('keeps dedupe false and the existing AVAILABLE/RESERVED dedupe scope', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    await db.stockItem.createMany({ data: [
      { variantId, content: 'HELD', status: 'RESERVED' },
      { variantId, content: 'SOLD', status: 'SOLD' },
    ] });
    expect(await admin.addStock(owner, variantId, { content: 'HELD\nSOLD\nSOLD' })).toEqual({ added: 1, skipped: 2, total: 1 });
    expect(await admin.addStock(owner, variantId, { content: 'SOLD\nSOLD', dedupe: false })).toEqual({ added: 2, skipped: 0, total: 3 });
  });

  it('rolls back stock and alert together with the caller transaction', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    await expect(db.$transaction(async (tx) => {
      await admin.addStock(owner, variantId, { content: 'TEST-ROLLBACK' }, tx);
      throw new Error('fixture rollback');
    })).rejects.toThrow('fixture rollback');
    expect(await db.stockItem.count({ where: { variantId } })).toBe(0);
    expect(await db.telegramStockAlert.count({ where: { productId: p.id } })).toBe(0);
  });

  it('rolls back a standalone import when the outbox insert fails in PostgreSQL', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    // Ràng buộc lỗi chỉ tồn tại trong database random của suite, không sửa schema thật.
    await db.$executeRawUnsafe('ALTER TABLE "TelegramStockAlert" ADD CONSTRAINT "test_outbox_failure" CHECK (false) NOT VALID');
    try {
      await expect(admin.addStock(owner, variantId, { content: 'TEST-OUTBOX-ROLLBACK' })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "TelegramStockAlert" DROP CONSTRAINT "test_outbox_failure"');
    }
    expect(await db.stockItem.count({ where: { variantId } })).toBe(0);
    expect(await db.telegramStockAlert.count({ where: { productId: p.id } })).toBe(0);
  });

  it('preserves plain numeric keys through Telegram prepare and production import', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const snapshot = await actions.snapshot('stock.import', variantId);
    const action = await actions.prepare(operator, 'stock.import', variantId, {
      content: '9007199254740993\n1e6\n001234\nKEY-A',
    }, snapshot.hash, snapshot.label);
    await actions.execute(operator, action);
    const rows = await db.stockItem.findMany({ where: { variantId }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => row.content)).toEqual(['9007199254740993', '1e6', '001234', 'KEY-A']);
  });

  it.each([
    {
      content: '{"accounts":[{"id":1},{"id":2}],"proxies":[],"version":3}',
      items: ['{"accounts":[{"id":1}],"proxies":[],"version":3}', '{"accounts":[{"id":2}],"proxies":[],"version":3}'],
    },
    { content: '[{"key":"A"},{"key":"B"}]', items: ['{"key":"A"}', '{"key":"B"}'] },
    { content: '{"key":"A"}\n{"key":"B"}', items: ['{"key":"A"}', '{"key":"B"}'] },
  ])('preserves structured import content through Telegram', async ({ content, items }) => {
    const p = await product();
    const variantId = p.variants[0].id;
    const snapshot = await actions.snapshot('stock.import', variantId);
    const action = await actions.prepare(operator, 'stock.import', variantId, { content }, snapshot.hash, snapshot.label);
    await actions.execute(operator, action);
    const rows = await db.stockItem.findMany({ where: { variantId }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => row.content)).toEqual(items);
  });

  it.each<StockStatus>(['AVAILABLE', 'RESERVED', 'SOLD', 'WITHDRAWN'])('refuses variant deletion with %s stock and preserves its content', async (status) => {
    const p = await product();
    const variantId = p.variants[0].id;
    const row = await db.stockItem.create({ data: { variantId, status, content: 'TEST-KEEP' } });
    await expect(admin.deleteVariant(owner, variantId)).rejects.toMatchObject({ message: 'admin.variant_has_stock' });
    expect(await db.stockItem.findUnique({ where: { id: row.id } })).toMatchObject({ variantId, status, content: 'TEST-KEEP' });
    expect(await db.productVariant.count({ where: { productId: p.id } })).toBe(2);
  });

  it('keeps order history even when no stock remains', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const order = await history(p.id, variantId);
    await expect(admin.deleteVariant(owner, variantId)).rejects.toMatchObject({ message: 'admin.variant_has_orders' });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).variantId).toBe(variantId);
  });

  it('serializes sibling deletions so the last variant survives', async () => {
    const p = await product();
    const counted = deferred();
    const release = deferred();
    let first = true;
    // Chỉ chặn sau truy vấn thật: bản cũ cùng thấy hai sibling, bản sửa xếp sau khóa Product.
    const hooked = db.$extends({ query: { productVariant: { async count({ args, query }) {
      const value = await query(args);
      if (first) { first = false; counted.resolve(); await release.promise; }
      return value;
    } } } });
    const firstDelete = service(hooked as unknown as PrismaClient).deleteVariant(owner, p.variants[0].id);
    const firstResult = firstDelete.then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
    await counted.promise;
    let completed = false;
    const secondResult = admin.deleteVariant(owner, p.variants[1].id).then(
      () => { completed = true; return { ok: true }; },
      (error: unknown) => { completed = true; return { ok: false, error }; },
    );
    try {
      await waitForBlocked(1, () => completed);
    } finally {
      release.resolve();
    }
    const results = await Promise.all([firstResult, secondResult]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: { message: 'admin.variant_last' } });
    expect(await db.productVariant.count({ where: { productId: p.id } })).toBe(1);
  }, 20_000);

  it('refuses product deletion with stock using a friendly conflict', async () => {
    const p = await product();
    const row = await db.stockItem.create({ data: { variantId: p.variants[0].id, content: 'TEST-PRODUCT-KEEP' } });
    await expect(admin.deleteProduct(owner, p.id)).rejects.toMatchObject({ message: 'admin.product_has_stock' });
    expect(await db.stockItem.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(await db.product.findUnique({ where: { id: p.id } })).not.toBeNull();
  });

  it('keeps a concurrent stock import when product deletion waits for its variant lock', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const inserted = deferred();
    const release = deferred();
    const incoming = db.$transaction(async (tx) => {
      await admin.addStock(owner, variantId, { content: 'TEST-IMPORT-BEFORE-DELETE' }, tx);
      inserted.resolve();
      await release.promise;
    }, { timeout: 15_000 });
    await inserted.promise;
    const deletion = admin.deleteProduct(owner, p.id).then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    try {
      await waitForBlocked(1);
    } finally {
      release.resolve();
      await incoming;
    }
    expect(await deletion).toMatchObject({ ok: false, error: { message: 'admin.product_has_stock' } });
    expect(await db.stockItem.findFirst({ where: { variantId } })).toMatchObject({ content: 'TEST-IMPORT-BEFORE-DELETE' });
  }, 20_000);

  it('maps FK RESTRICT on variant order history to a friendly product error', async () => {
    const p = await product();
    const other = await product();
    // Dữ liệu lịch sử có thể lệch productId: FK variant vẫn phải giữ nguyên chứng cứ.
    const order = await history(other.id, p.variants[0].id);
    await expect(admin.deleteProduct(owner, p.id)).rejects.toMatchObject({ message: 'admin.product_has_orders' });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).variantId).toBe(p.variants[0].id);
    expect(await db.productVariant.count({ where: { productId: p.id } })).toBe(2);
  });

  it('allows deletion of an unused non-last variant and an unused product', async () => {
    const p = await product();
    await expect(admin.deleteVariant(owner, p.variants[0].id)).resolves.toEqual({ success: true });
    await expect(admin.deleteVariant(owner, p.variants[1].id)).rejects.toMatchObject({ message: 'admin.variant_last' });
    await expect(admin.deleteProduct(owner, p.id)).resolves.toEqual({ success: true });
  });

  it('database RESTRICT prevents bypassing stock protection', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const row = await db.stockItem.create({ data: { variantId, content: 'TEST-FK-KEEP' } });
    await expect(db.productVariant.delete({ where: { id: variantId } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await db.stockItem.findUnique({ where: { id: row.id } })).toMatchObject({ variantId });
  });

  it('database RESTRICT prevents detaching order history', async () => {
    const p = await product();
    const variantId = p.variants[0].id;
    const order = await history(p.id, variantId);
    await expect(db.productVariant.delete({ where: { id: variantId } })).rejects.toMatchObject({ code: 'P2003' });
    expect((await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).variantId).toBe(variantId);
  });
});
