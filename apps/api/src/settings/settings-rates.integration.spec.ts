import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { AdminActor } from '../audit/admin-actor';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateService } from '../rates/exchange-rate.service';
import { SettingsService } from './settings.service';

// Chỉ runner cấp URL cluster cô lập; không fallback sang database dev/thật.
const base = process.env.DATABASE_URL;
const name = `webcatt_settings_rates_${process.pid}`;
const client = (database: string) => {
  const url = new URL(base!);
  url.pathname = '/' + database;
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
};
let db: PrismaClient;
let settings: SettingsService;
let rates: ExchangeRateService;
let variantId: string;
const actor = { id: 'fixture', email: 'fixture@example.test', code: 1, role: 'SUPERADMIN' } as AdminActor;

function service(prisma: PrismaClient) {
  return new SettingsService(prisma as PrismaService, new ConfigService({}), new AuditService(prisma as PrismaService));
}

beforeAll(async () => {
  if (!base) throw new Error('Run with the isolated PostgreSQL runner');
  const admin = client('postgres');
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); }
  finally { await admin.$disconnect(); }
  db = client(name);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/\r?\n/).filter(line => !line.trim().startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)) {
      await db.$executeRawUnsafe(statement);
    }
  }
  await db.user.create({ data: { id: 'fixture', code: actor.code, email: actor.email, role: 'SUPERADMIN', passwordHash: 'fixture' } });
  settings = service(db);
  rates = new ExchangeRateService(db as PrismaService, settings);
}, 120_000);

beforeEach(async () => {
  await db.$executeRawUnsafe('ALTER TABLE "ProductVariant" DROP CONSTRAINT IF EXISTS "fixture_price_floor"');
  await db.order.deleteMany();
  await db.productVariant.deleteMany();
  await db.product.deleteMany();
  await db.storeSetting.deleteMany();
  await db.storeSetting.create({ data: {
    id: 'main', vndPerUsdt: 25_000, cnyPerUsdt: 7, rateMarkupPercent: 0,
    aiApiKey: 'fixture-ai-old', telegramBotToken: '123456:fixture-old',
    sepayApiKey: 'fixture-sepay-old', supportNote: 'before',
  } });
  const product = await db.product.create({ data: { slug: 'test-rates', name: 'TEST-RATES' } });
  const variant = await db.productVariant.create({ data: {
    productId: product.id, name: 'VND', priceCurrency: 'VND', priceAmount: 100_000, price: 4,
  } });
  variantId = variant.id;
  await db.productVariant.createMany({ data: [
    { productId: product.id, name: 'CNY', priceCurrency: 'CNY', priceAmount: 100, price: 14.285714 },
    { productId: product.id, name: 'USDT', priceCurrency: 'USDT', priceAmount: 5, price: 5 },
  ] });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: 'success', rates: { VND: 26_000, CNY: 8 } }))));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  if (!db) return;
  await db.$disconnect();
  const admin = client('postgres');
  try { await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
  finally { await admin.$disconnect(); }
});

async function snapshot() {
  const setting = await db.storeSetting.findUniqueOrThrow({ where: { id: 'main' } });
  const variants = await db.productVariant.findMany({ orderBy: { name: 'asc' } });
  return { vnd: Number(setting.vndPerUsdt), cny: Number(setting.cnyPerUsdt), prices: variants.map(v => Number(v.price)) };
}

describe('settings/rates atomic production writes', () => {
  it.each(['manual', 'auto'] as const)('%s recalculates VND/CNY anchors with numeric floor at six digits', async mode => {
    if (mode === 'manual') await settings.updateSection(actor, { vndPerUsdt: 26_000, cnyPerUsdt: 8 });
    else await rates.refresh();
    expect(await snapshot()).toEqual({ vnd: 26_000, cny: 8, prices: [12.5, 5, 3.846153] });
    expect(Math.ceil(Number((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).price) * 26_000)).toBe(100_000);
  });

  it.each(['manual', 'auto'] as const)('%s rolls back the rate if an anchored price write fails', async mode => {
    await db.$executeRawUnsafe('ALTER TABLE "ProductVariant" ADD CONSTRAINT "fixture_price_floor" CHECK ("priceCurrency" != \'VND\' OR "price" >= 4)');
    const before = await snapshot();
    const write = mode === 'manual' ? settings.updateSection(actor, { vndPerUsdt: 26_000 }) : rates.refresh();
    await expect(write).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('changing rates keeps the price and amount already captured on an order', async () => {
    const variant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    const order = await db.order.create({ data: {
      code: 'DH-RATE-SNAPSHOT', userId: 'fixture', subtotalAmount: 4, totalAmount: 4,
      items: { create: { productId: variant.productId, productName: 'TEST-RATES', variantId, unitPrice: 4, quantity: 1 } },
    }, include: { items: true } });
    await settings.updateSection(actor, { vndPerUsdt: 26_000, cnyPerUsdt: 8 });
    const saved = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(Number(saved.totalAmount)).toBe(4);
    expect(Number(saved.items[0].unitPrice)).toBe(4);
    expect(Number((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).price)).toBe(3.846153);
  });

  it('concurrent manual and auto commits cannot mix one rate with another anchored price', async () => {
    await Promise.all([
      rates.refresh(),
      settings.updateSection(actor, { vndPerUsdt: 27_000, cnyPerUsdt: 9 }),
    ]);
    const saved = await snapshot();
    expect([
      { vnd: 26_000, cny: 8, prices: [12.5, 5, 3.846153] },
      { vnd: 27_000, cny: 9, prices: [11.111111, 5, 3.703703] },
    ]).toContainEqual(saved);
  });

  it('explicit blank clears a secret while omitted secrets stay unchanged', async () => {
    await settings.updateSection(actor, { aiApiKey: '', supportNote: 'after' });
    const saved = await db.storeSetting.findUniqueOrThrow({ where: { id: 'main' } });
    expect(saved.aiApiKey).toBe('');
    expect(saved.telegramBotToken).toBe('123456:fixture-old');
    expect(saved.sepayApiKey).toBe('fixture-sepay-old');
    const audits = await db.auditLog.findMany({ where: { entityId: 'main' } });
    expect(JSON.stringify(audits)).not.toContain('fixture-ai-old');
  });

  it('concurrent rates/support PATCH preserves both changes and omitted secrets', async () => {
    let count = 0;
    let release!: () => void;
    const readBarrier = new Promise<void>(resolve => { release = resolve; });
    const concurrent = db.$extends({ query: { storeSetting: { async upsert({ args, query }) {
      const result = await query(args);
      if (++count <= 2) {
        if (count === 2) release();
        await readBarrier;
      }
      return result;
    } } } });
    const target = service(concurrent as unknown as PrismaClient);
    await Promise.all([
      target.updateSection(actor, { vndPerUsdt: 26_000 }),
      target.updateSection(actor, { supportNote: 'after', aiApiKey: 'fixture-ai-new' }),
    ]);
    const saved = await db.storeSetting.findUniqueOrThrow({ where: { id: 'main' } });
    expect(Number(saved.vndPerUsdt)).toBe(26_000);
    expect(saved.supportNote).toBe('after');
    expect(saved.aiApiKey).toBe('fixture-ai-new');
    expect(saved.sepayApiKey).toBe('fixture-sepay-old');
    expect(saved.telegramBotToken).toBe('123456:fixture-old');
  });

  it('concurrent Telegram token/greeting PATCH preserves both owned fields', async () => {
    let count = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const concurrent = db.$extends({ query: { storeSetting: { async upsert({ args, query }) {
      const result = await query(args);
      if (++count <= 2) {
        if (count === 2) release();
        await barrier;
      }
      return result;
    } } } });
    const target = service(concurrent as unknown as PrismaClient);
    await Promise.all([
      target.updateTelegram(actor, { telegramBotToken: '123456:fixture-new' }),
      target.updateTelegram(actor, { telegramGreeting: 'after' }),
    ]);
    const saved = await db.storeSetting.findUniqueOrThrow({ where: { id: 'main' } });
    expect(saved.telegramBotToken).toBe('123456:fixture-new');
    expect(saved.telegramGreeting).toBe('after');
    expect(saved.aiApiKey).toBe('fixture-ai-old');
  });

  it('zero disables conversion without dividing anchored prices by zero', async () => {
    await settings.updateSection(actor, { vndPerUsdt: 0, cnyPerUsdt: 0 });
    expect(await snapshot()).toEqual({ vnd: 0, cny: 0, prices: [14.285714, 5, 4] });
  });
});
