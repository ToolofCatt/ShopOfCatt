import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient, type User } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { FulfillmentService } from '../orders/fulfillment.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import type { TranslationService } from '../translation/translation.service';
import { AdminService } from './admin.service';

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_stock_alert_test';

function urlForDatabase(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function client(database: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: urlForDatabase(database) } } });
}

async function applyMigrations(db: PrismaClient): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  }
}

let reachable = false;
let prisma: PrismaClient;
let service: AdminService;
let actor: User;

beforeAll(async () => {
  const admin = client('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    reachable = true;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } catch {
    return;
  } finally {
    await admin.$disconnect();
  }

  prisma = client(TEST_DB);
  await applyMigrations(prisma);
  service = new AdminService(
    prisma as unknown as PrismaService,
    {} as FulfillmentService,
    {} as TranslationService,
    { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    {} as SettingsService,
  );
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const admin = client('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}, 60_000);

describe('AdminService.addStock → Telegram stock alert', () => {
  it('xếp đúng người nhận; không báo dòng trùng hoặc loại đã tắt', async (ctx) => {
    if (!reachable) {
      ctx.skip();
      return;
    }

    actor = await prisma.user.create({
      data: { code: 91000001, email: 'admin-alert@test.local', passwordHash: 'x', role: 'ADMIN' },
    });
    await prisma.user.createMany({
      data: [
        {
          code: 91000002,
          passwordHash: 'x',
          telegramChatId: '111001',
          telegramLang: 'vi',
        },
        {
          code: 91000003,
          passwordHash: 'x',
          telegramChatId: '111002',
          telegramLang: 'en',
        },
        { code: 91000004, email: 'web@test.local', passwordHash: 'x' },
        {
          code: 91000005,
          passwordHash: 'x',
          telegramChatId: '111003',
          telegramLang: 'zh',
          lockedAt: new Date(),
        },
      ],
    });
    await prisma.storeSetting.create({
      data: {
        id: 'main',
        telegramBotEnabled: true,
        telegramBotToken: `123456:${'A'.repeat(35)}`,
        telegramStockAlertsEnabled: true,
      },
    });
    const product = await prisma.product.create({
      data: {
        slug: 'stock-alert-product',
        name: 'ChatGPT Plus',
        variants: {
          create: {
            name: '30 ngày',
            price: 3.852198,
            priceCurrency: 'VND',
            priceAmount: 100_000,
          },
        },
      },
      include: { variants: true },
    });
    const variantId = product.variants[0].id;

    const first = await service.addStock(actor, variantId, {
      content: 'KEY-A\nKEY-B\nKEY-A',
      dedupe: true,
    });
    expect(first).toEqual({ added: 2, skipped: 1, total: 2 });

    const alert = await prisma.telegramStockAlert.findFirstOrThrow({
      include: { recipients: { orderBy: { lang: 'asc' } } },
    });
    expect(alert).toMatchObject({
      productName: 'ChatGPT Plus',
      variantName: '30 ngày',
      added: 2,
      total: 2,
    });
    expect(alert.recipients.map((recipient) => recipient.lang)).toEqual(['en', 'vi']);

    const duplicate = await service.addStock(actor, variantId, {
      content: 'KEY-A\nKEY-B',
      dedupe: true,
    });
    expect(duplicate.added).toBe(0);
    expect(await prisma.telegramStockAlert.count()).toBe(1);

    await prisma.productVariant.update({ where: { id: variantId }, data: { active: false } });
    const inactive = await service.addStock(actor, variantId, {
      content: 'KEY-C',
      dedupe: true,
    });
    expect(inactive).toEqual({ added: 1, skipped: 0, total: 3 });
    expect(await prisma.telegramStockAlert.count()).toBe(1);
  });
});
