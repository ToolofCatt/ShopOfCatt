import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MailCatalogService } from './mail-catalog.service';
import { MailPurchaseService } from './mail-purchase.service';
import { MailInboxService } from './mail-inbox.service';
import { FiveMailClient } from './fivemail.client';
import { PrismaService } from '../prisma/prisma.service';

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/webcatt');
const database = 'webcatt_mail_test';
function client(name: string) { const u = new URL(url); u.pathname = '/'+name; return new PrismaClient({ datasources: { db: { url: u.toString() } } }); }
let db: PrismaClient, reachable = false, catalog: MailCatalogService, purchases: MailPurchaseService, inbox: MailInboxService;
const provider = { info: vi.fn(), buy: vi.fn(), list: vi.fn() };
let userId: string, otherId: string, publicId: string;
beforeAll(async () => {
  const admin = client('postgres');
  try { await admin.$queryRaw`SELECT 1`; reachable = true; await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); } catch { return; } finally { await admin.$disconnect(); }
  db = client(database);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const folder of readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8').split(/\r?\n/).filter(line => !line.trim().startsWith('--')).join('\n');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  }
  catalog = new MailCatalogService(db as PrismaService, provider as unknown as FiveMailClient);
  purchases = new MailPurchaseService(db as PrismaService, catalog, provider as unknown as FiveMailClient);
  inbox = new MailInboxService(db as PrismaService);
}, 60_000);
beforeEach(async () => {
  if (!reachable) return;
  await db.mailCode.deleteMany(); await db.mailbox.deleteMany(); await db.mailPurchase.deleteMany(); await db.balanceEntry.deleteMany(); await db.auditLog.deleteMany(); await db.user.deleteMany(); await db.mailOffer.deleteMany();
  const user = await db.user.create({ data: { code: 80000001, email: 'buyer@example.test', passwordHash: 'fixture', balance: 1 } }); userId = user.id;
  otherId = (await db.user.create({ data: { code: 80000002, email: 'other@example.test', passwordHash: 'fixture', role: 'SUPERADMIN' } })).id;
  await db.mailProviderSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  await db.mailProviderSetting.update({ where: { id: 1 }, data: { token: 'fixture', enabled: true, currencyConfirmed: true, multiplier: 2, maxOrderCost: 5, maxDailyCost: 50 } });
  await db.storeSetting.upsert({ where: { id: 'main' }, create: { id: 'main', vndPerUsdt: 26000 }, update: { vndPerUsdt: 26000 } });
  await db.storeSetup.upsert({ where: { id: 'main' }, create: { id: 'main', maintenanceMode: false, publishedAt: new Date() }, update: { maintenanceMode: false, publishedAt: new Date() } });
  publicId = (await db.mailOffer.create({ data: { code: 'g_api_test', name: 'Test Mail', category: 'gmail-api', cost: '0.033', stock: 20, syncedAt: new Date() } })).publicId;
  provider.info.mockReset().mockResolvedValue({ code: 'g_api_test', name: 'Test Mail', price: '0.033', stock: 20 });
  provider.buy.mockReset().mockImplementation(async (_token: string, code: string, count: number) => ({ orderNo: 'S'+randomUUID(), productCode: code, totalPrice: String(count*0.033), lines: Array.from({ length: count }, () => `${randomUUID()}@example.test----https://gapi.mailsapi.com/api/get-code?uid=${randomUUID()}`) }));
});
afterAll(async () => { if (!db) return; await db.$disconnect(); const admin = client('postgres'); try { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`); } finally { await admin.$disconnect(); } });
function testDb(name: string, body: () => Promise<void>) { it(name, async ctx => { if (!reachable) { ctx.skip(); return; } await body(); }); }
const input = () => ({ requestId: randomUUID(), offerCode: publicId, quantity: 2, expectedUnitPrice: '0.066' });

describe('mail transactions on isolated PostgreSQL', () => {
  testDb('VND3000 stays anchored after rate changes and purchase snapshots never move', async () => {
    await catalog.updateOffer('g_api_test', { useMultiplier: false, saleCurrency: 'VND', saleAmount: '3000' });
    const first = (await catalog.catalog()).offers[0];
    expect(first.priceCurrency).toBe('VND'); expect(first.priceAmount).toBe('3000'); expect(first.price).toBe('0.115384');
    expect(first.code).toBe(publicId); expect(JSON.stringify(first)).not.toContain('g_api_');
    await purchases.rent(userId, { ...input(), expectedUnitPrice: first.price });
    const order = await db.mailPurchase.findFirstOrThrow();
    expect(order.priceAmount?.toString()).toBe('3000'); expect(order.unitPrice.toString()).toBe('0.115384');
    await db.storeSetting.update({ where: { id: 'main' }, data: { vndPerUsdt: 25000 } });
    const next = (await catalog.catalog()).offers[0]; expect(next.price).toBe('0.12'); expect(next.priceAmount).toBe('3000');
    expect((await db.mailPurchase.findUniqueOrThrow({ where: { id: order.id } })).total.toString()).toBe('0.230768');
    expect((await inbox.list(userId)).mailboxes[0].priceAmount).toBe('3000');
    await catalog.updateOffer('g_api_test', { useMultiplier: false, saleCurrency: 'USDT', saleAmount: '0.15' });
    expect((await catalog.catalog()).offers[0].price).toBe('0.15');
    await catalog.updateOffer('g_api_test', { useMultiplier: true });
    expect((await catalog.catalog()).offers[0].price).toBe('0.066');
  });
  testDb('bulk update is atomic, rate/amount validated, and sync preserves anchored settings', async () => {
    await expect(catalog.updateOffers(['g_api_test', 'missing'], { saleCurrency: 'VND', saleAmount: '3000' })).rejects.toThrow();
    expect((await db.mailOffer.findUniqueOrThrow({ where: { code: 'g_api_test' } })).saleAmount).toBeNull();
    await expect(catalog.updateOffers(['g_api_test'], { saleCurrency: 'VND', saleAmount: '3.5' })).rejects.toThrow();
    await db.storeSetting.update({ where: { id: 'main' }, data: { vndPerUsdt: 0 } });
    await expect(catalog.updateOffer('g_api_test', { saleCurrency: 'VND', saleAmount: '3000' })).rejects.toThrow('mail.rate_required');
    await db.storeSetting.update({ where: { id: 'main' }, data: { vndPerUsdt: 26000 } });
    await db.mailOffer.create({ data: { code: 'g_api_other', name: 'Other', category: 'gmail-api', cost: '.02', stock: 10, syncedAt: new Date() } });
    await catalog.updateOffers(['g_api_test', 'g_api_other'], { saleCurrency: 'VND', saleAmount: '3000' });
    expect(await db.mailOffer.count({ where: { saleCurrency: 'VND', saleAmount: 3000 } })).toBe(2);
    provider.list.mockImplementation(async (_token: string, category: string) => category === 'gmail-api' ? [{ code: 'g_api_test', name: 'Test Mail', price: '0.034', stock: 20 }] : []);
    await catalog.refresh(true);
    expect((await db.mailOffer.findUniqueOrThrow({ where: { code: 'g_api_test' } })).saleAmount?.toString()).toBe('3000');
  });
  testDb('catalog/workspace/TXT hide upstream identity and reject raw provider offer codes', async () => {
    await db.mailOffer.update({ where: { code: 'g_api_test' }, data: { name: 'ChatGPT | 5Mail.io' } });
    const publicData = await catalog.catalog();
    expect(publicData.offers[0].name).toBe('ChatGPT'); expect(publicData.offers[0].code).toBe(publicId);
    await expect(purchases.rent(userId, { ...input(), offerCode: 'g_api_test' })).rejects.toThrow('mail.unavailable');
    await purchases.rent(userId, input());
    const customerData = JSON.stringify(await inbox.list(userId));
    const exported = await inbox.export(userId);
    for (const secret of ['5mail', 'mailsapi', 'g_api_', 'https://', 'uid=']) { expect(customerData.toLowerCase()).not.toContain(secret); expect(exported.toLowerCase()).not.toContain(secret); }
    expect((await catalog.catalog(true)).offers[0].code).toBe('g_api_test');
  });
  testDb('catalog sync and purchase share Setting-to-Offer lock order without losing admin overrides', async () => {
    provider.list.mockImplementation(async (_token: string, category: string) => category === 'gmail-api' ? [{ code: 'g_api_test', name: 'Test Mail', price: '0.033', stock: 20 }] : []);
    await db.mailOffer.update({ where: { code: 'g_api_test' }, data: { salePrice: '0.07' } });
    await Promise.all([catalog.refresh(true), purchases.rent(userId, { ...input(), expectedUnitPrice: '0.07' })]);
    expect((await db.mailOffer.findUniqueOrThrow({ where: { code: 'g_api_test' } })).salePrice?.toString()).toBe('0.07');
    expect(provider.buy).toHaveBeenCalledTimes(1);
  });
  testDb('fresh install does not change existing stock/order counts; duplicate rent debits and buys once', async () => {
    const counts = [await db.order.count(), await db.stockItem.count()];
    const request = input(); const results = await Promise.all(Array.from({ length: 5 }, () => purchases.rent(userId, request)));
    expect(new Set(results.map(r => r.id)).size).toBe(1); expect(provider.buy).toHaveBeenCalledTimes(1);
    expect(await db.balanceEntry.count()).toBe(1); expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).balance.toString()).toBe('0.868');
    expect(await db.mailbox.count()).toBe(2); expect([await db.order.count(), await db.stockItem.count()]).toEqual(counts);
  });
  testDb('concurrent different requests cannot overspend the user balance', async () => {
    await db.user.update({ where: { id: userId }, data: { balance: '0.15' } });
    const result = await Promise.allSettled([purchases.rent(userId, input()), purchases.rent(userId, input())]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(provider.buy).toHaveBeenCalledTimes(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).balance.toString()).toBe('0.018');
  });
  testDb('uncertain provider result is REVIEW and replay never buys again; refund requires evidence and is idempotent', async () => {
    provider.buy.mockRejectedValue(new Error('network timeout'));
    const request = input(); const result = await purchases.rent(userId, request); await purchases.rent(userId, request);
    await expect(purchases.rent(userId, input())).rejects.toThrow('mail.request_conflict');
    expect(provider.buy).toHaveBeenCalledTimes(1); expect((await db.mailPurchase.findUniqueOrThrow({ where: { id: result.id } })).status).toBe('REVIEW');
    const actor = await db.user.findUniqueOrThrow({ where: { id: otherId } });
    await expect(purchases.refund(actor, result.id, false, 'provider confirms no delivery')).rejects.toThrow();
    await Promise.all([purchases.refund(actor, result.id, true, 'provider confirms no delivery'), purchases.refund(actor, result.id, true, 'provider confirms no delivery')]);
    expect(await db.balanceEntry.count()).toBe(2); expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).balance.toString()).toBe('1');
  });
  testDb('disabled source, stale accepted price, changed request identity and cost caps fail before provider buy', async () => {
    await expect(purchases.rent(userId, { ...input(), expectedUnitPrice: '0.01' })).rejects.toThrow('mail.price_changed');
    await db.mailProviderSetting.update({ where: { id: 1 }, data: { maxOrderCost: '0.01' } });
    await expect(purchases.rent(userId, input())).rejects.toThrow('mail.spend_limit');
    await db.mailProviderSetting.update({ where: { id: 1 }, data: { enabled: false } });
    await expect(purchases.rent(userId, input())).rejects.toThrow('mail.not_ready');
    expect(provider.buy).not.toHaveBeenCalled(); expect(await db.balanceEntry.count()).toBe(0);
  });
  testDb('ownership, old codes and server-only inbox URL survive polling errors and close', async () => {
    await purchases.rent(userId, input()); const m = await db.mailbox.findFirstOrThrow();
    await db.mailCode.createMany({ data: Array.from({ length: 101 }, (_,i) => ({ mailboxId: m.id, code: String(i).padStart(6,'0') })) });
    const list = await inbox.list(userId); expect(list.mailboxes.find(x => x.id === m.id)?.codes).toHaveLength(101); expect(JSON.stringify(list)).not.toContain('mailsapi');
    expect((await inbox.list(otherId)).mailboxes).toHaveLength(0); await expect(inbox.close(otherId, m.id)).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    try { await inbox.poll(userId, [m.id]); } finally { vi.unstubAllGlobals(); }
    expect((await db.mailbox.findUniqueOrThrow({ where: { id: m.id } })).pollFailed).toBe(true);
    expect(await db.mailCode.count({ where: { mailboxId: m.id } })).toBe(101);
    await inbox.close(userId, m.id); expect((await inbox.list(userId)).mailboxes.find(x => x.id === m.id)?.closed).toBe(true);
  });
});
