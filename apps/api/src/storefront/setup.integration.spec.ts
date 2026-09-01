import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../audit/audit.service';
import type { BinanceExchangeService } from '../binance-exchange/binance-exchange.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import type { TranslationService } from '../translation/translation.service';
import type { StorefrontService } from './storefront.service';
import { SetupService } from './setup.service';
import { StorefrontService as RealStorefrontService } from './storefront.service';

const BASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_setup_test';
const LEGACY_DB = 'webcatt_setup_legacy_test';
let reachable = false;
let prisma: PrismaClient;

function client(database: string): PrismaClient {
  const url = new URL(BASE_URL); url.pathname = `/${database}`;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function applyMigrations(db: PrismaClient, before?: string): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  for (const folder of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().filter((entry) => before === undefined || entry < before)) {
    const statements = readFileSync(join(dir, folder, 'migration.sql'), 'utf8').split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((entry) => entry.trim()).filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  }
}

beforeAll(async () => {
  const admin = client('postgres');
  try { await admin.$queryRaw`SELECT 1`; reachable = true; } catch { reachable = false; } finally { await admin.$disconnect(); }
  if (!reachable) return;
  const root = client('postgres');
  try { await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${LEGACY_DB}" WITH (FORCE)`); await root.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`); } finally { await root.$disconnect(); }
  prisma = client(TEST_DB); await applyMigrations(prisma);
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const root = client('postgres');
  try { await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`); await root.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${LEGACY_DB}" WITH (FORCE)`); } finally { await root.$disconnect(); }
});

describe('Setup inventory rollback diagnostic (tích hợp)', () => {
  it('fresh migration chưa tự xuất bản cửa hàng', async (ctx) => {
    if (!reachable) return ctx.skip();
    expect(await prisma.storeSetup.count()).toBe(0);
    expect(await prisma.storefrontRevision.count()).toBe(0);
    const config = { get: (key: string) => key === 'STORE_BOOTSTRAP_NAME' ? 'Digital Store' : undefined } as unknown as ConfigService;
    const audit = { log: async () => undefined } as unknown as AuditService;
    const publicStore = await new RealStorefrontService(prisma as unknown as PrismaService, config, audit).getPublic();
    expect(publicStore).toMatchObject({ published: false, maintenanceMode: true, revision: 0 });
    expect(await prisma.storeSetup.findUniqueOrThrow({ where: { id: 'main' } })).toMatchObject({ publishedAt: null, maintenanceMode: true });
  });

  it('migration giữ deployment cũ ở trạng thái published', async (ctx) => {
    if (!reachable) return ctx.skip();
    const root = client('postgres');
    try { await root.$executeRawUnsafe(`CREATE DATABASE "${LEGACY_DB}"`); } finally { await root.$disconnect(); }
    const legacy = client(LEGACY_DB);
    try {
      await applyMigrations(legacy, '20260901143000_digital_store_commercial');
      await legacy.storeSetting.create({ data: { id: 'main' } });
      const migration = resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260901143000_digital_store_commercial', 'migration.sql');
      const statements = readFileSync(migration, 'utf8').split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((entry) => entry.trim()).filter(Boolean);
      for (const statement of statements) await legacy.$executeRawUnsafe(statement);
      expect(await legacy.storeSetup.findUniqueOrThrow({ where: { id: 'main' } })).toMatchObject({ maintenanceMode: false, currentStep: 'review' });
      expect((await legacy.storeSetup.findUniqueOrThrow({ where: { id: 'main' } })).publishedAt).not.toBeNull();
    } finally {
      await legacy.$disconnect();
      const admin = client('postgres');
      try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${LEGACY_DB}" WITH (FORCE)`); } finally { await admin.$disconnect(); }
    }
  }, 120_000);

  it('khóa Order trước StockItem rồi rollback, không tạo hoặc đổi dữ liệu nghiệp vụ', async (ctx) => {
    if (!reachable) return ctx.skip();
    const product = await prisma.product.create({ data: { slug: 'setup-probe', name: 'Setup probe', variants: { create: { name: 'Default', price: '1', priceAmount: '1' } } }, include: { variants: true } });
    const stock = await prisma.stockItem.create({ data: { variantId: product.variants[0].id, content: 'SETUP-PROBE-CONTENT' } });
    const before = await counts();
    const service = new SetupService(
      prisma as unknown as PrismaService,
      {} as ConfigService,
      {} as SettingsService,
      {} as BinanceExchangeService,
      {} as TranslationService,
      {} as StorefrontService,
      {} as AuditService,
    );
    const probe = await (service as unknown as { runStockRollbackProbe(): Promise<{ ok: boolean; detail: string }> }).runStockRollbackProbe();
    expect(probe.ok).toBe(true);
    expect(probe.detail).toMatch(/rollback/);
    expect(await counts()).toEqual(before);
    expect(await prisma.stockItem.findUniqueOrThrow({ where: { id: stock.id } })).toMatchObject({ status: 'AVAILABLE', orderItemId: null });
  });

  it('CAS chặn hai tab ghi đè và chỉ giữ 20 revision bất biến', async (ctx) => {
    if (!reachable) return ctx.skip();
    const actor = await prisma.user.create({ data: { code: 90817263, email: 'setup-owner@example.test', passwordHash: 'not-used', role: 'SUPERADMIN' } });
    const config = { get: (key: string) => key === 'STORE_BOOTSTRAP_NAME' ? 'Digital Store' : undefined } as unknown as ConfigService;
    const audit = { log: async () => undefined } as unknown as AuditService;
    const storefront = new RealStorefrontService(prisma as unknown as PrismaService, config, audit);
    const initial = await storefront.getDraft();
    const first = structuredClone(initial.document); first.brand.name = 'Store revision 1';
    first.pages.home.blocks.push({ id: 'sanitized-rich-text', type: 'richText', props: { html: { vi: '<p>Hợp lệ</p><script>alert(1)</script>', en: '', zh: '' } } });
    const saved = await storefront.updateDraft(actor, initial.version, first);
    expect(JSON.stringify(saved.document)).toContain('<p>Hợp lệ</p>');
    expect(JSON.stringify(saved.document)).not.toContain('<script>');
    await expect(storefront.updateDraft(actor, initial.version, first)).rejects.toMatchObject({ status: 409 });
    for (let index = 0; index < 22; index += 1) {
      const document = structuredClone(saved.document); document.brand.name = `Store revision ${index + 1}`;
      await storefront.publish(actor, document);
    }
    const rows = await prisma.storefrontRevision.findMany({ orderBy: { version: 'asc' } });
    expect(rows).toHaveLength(20);
    expect(rows[0].version).toBe(3);
    expect(rows.at(-1)?.version).toBe(22);
    expect((rows[0].document as { brand: { name: string } }).brand.name).toBe('Store revision 3');
  }, 30_000);
});

async function counts() {
  const [orders, products, variants, stock] = await Promise.all([prisma.order.count(), prisma.product.count(), prisma.productVariant.count(), prisma.stockItem.count()]);
  return { orders, products, variants, stock };
}
