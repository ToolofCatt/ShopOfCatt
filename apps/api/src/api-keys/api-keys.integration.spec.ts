import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaClient, type User } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaExceeded, ApiQuotaService } from './api-quota.service';

// Chỉ chạy khi runner cấp DB thử riêng; không dò .env hoặc đụng CSDL cửa hàng.
const baseUrl = process.env.API_KEYS_TEST_DATABASE_URL;
const database = `api_keys_test_${randomUUID().replaceAll('-', '')}`;
let admin: PrismaClient;
let prisma: PrismaClient;
let keys: ApiKeysService;
let quota: ApiQuotaService;
let actor: User;
let nextCode = 71000000;

function urlFor(name: string): string {
  const url = new URL(baseUrl!); url.pathname = `/${name}`; return url.toString();
}
function client(name: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: urlFor(name) } } });
}
async function user(approved = true): Promise<User> {
  const owner = await prisma.user.create({ data: { code: nextCode++, email: `${randomUUID()}@api-key.test`, passwordHash: 'not-a-login-password' } });
  if (approved) await keys.setAccess(actor, owner.id, true);
  return owner;
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe.skipIf(!baseUrl)('API keys / isolated PostgreSQL', () => {
  beforeAll(async () => {
    admin = client('postgres');
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    prisma = client(database);
    const dir = resolve(__dirname, '../../prisma/migrations');
    for (const entry of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      const sql = readFileSync(join(dir, entry, 'migration.sql'), 'utf8');
      const statements = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((sql) => sql.trim()).filter(Boolean);
      for (const statement of statements) await prisma.$executeRawUnsafe(statement);
    }
    quota = new ApiQuotaService(prisma as PrismaService);
    keys = new ApiKeysService(prisma as PrismaService, quota);
    actor = await prisma.user.create({ data: { code: nextCode++, email: 'superadmin@api-key.test', role: 'SUPERADMIN', passwordHash: 'not-a-login-password' } });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.$disconnect();
    }
  });

  it('GET missing approval stays read-only and reads precise wallet balance from DB', async () => {
    const owner = await user(false);
    await prisma.user.update({ where: { id: owner.id }, data: { balance: '12.345678' } });
    expect(await keys.getAccount(owner.id)).toEqual({ access: { enabled: false, approvedAt: null, disabledAt: null }, keys: [], balance: '12.345678', currency: 'USDT' });
    expect(await prisma.apiAccess.findUnique({ where: { userId: owner.id } })).toBeNull();
    await expect(keys.createKey(owner.id, { name: 'denied' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns secret once, persists digest only, and defaults to read-only 30 days', async () => {
    const owner = await user();
    const created = await keys.createKey(owner.id, { name: ' fixture ' });
    expect(created.secret).toMatch(/^catt_c[a-z0-9]{24}\.[A-Za-z0-9_-]{43}$/);
    expect(created.key.scopes).toEqual(['catalog:read', 'wallet:read', 'deposits:read', 'orders:read']);
    expect(created.key.name).toBe('fixture');
    expect(new Date(created.key.expiresAt).getTime() - new Date(created.key.createdAt).getTime()).toBeGreaterThan(29 * 86400000);
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.key.id } });
    expect(stored.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.prefix).toBe(`catt_${created.key.id}`);
    const audits = await prisma.auditLog.findMany({ where: { entityId: created.key.id } });
    const list = await keys.getAccount(owner.id);
    for (const projection of [stored, audits, list, await keys.listAccountKeys(owner.id)]) {
      expect(JSON.stringify(projection)).not.toContain(created.secret.split('.')[1]);
    }
    expect(JSON.stringify(list)).not.toContain(stored.digest);
    expect(audits.map((audit) => audit.action)).toEqual(['api_key.create']);
    expect((await keys.authenticate(created.secret)).ownerId).toBe(owner.id);
  });

  it('admits at most five concurrent creations and does not grant a sixth after rotation', async () => {
    const owner = await user();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => keys.createKey(owner.id, { name: `key-${i}` })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(await prisma.apiKey.count({ where: { ownerId: owner.id, revokedAt: null } })).toBe(5);
    const key = await prisma.apiKey.findFirstOrThrow({ where: { ownerId: owner.id } });
    await keys.revokeOwnKey(owner.id, key.id);
    await expect(keys.createKey(owner.id, { name: 'sixth' })).rejects.toBeInstanceOf(ApiQuotaExceeded);
    await prisma.apiRateBucket.deleteMany({ where: { id: { startsWith: `owner:${owner.id}:create-key:` } } });
    await keys.createKey(owner.id, { name: 'replacement' });
    await expect(keys.createKey(owner.id, { name: 'over active cap' })).rejects.toMatchObject({ status: 400 });
  });

  it('cannot revoke someone else’s key and allows owner revocation after approval disabled', async () => {
    const owner = await user(); const other = await user();
    const created = await keys.createKey(owner.id, { name: 'private' });
    await expect(keys.revokeOwnKey(other.id, created.key.id)).rejects.toMatchObject({ status: 404 });
    await prisma.apiAccess.update({ where: { userId: owner.id }, data: { enabled: false } });
    await keys.revokeOwnKey(owner.id, created.key.id);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: created.key.id } })).revokedAt).not.toBeNull();
  });

  it('disable revokes all keys atomically and reapproval never revives historical rows', async () => {
    const owner = await user();
    const created = await keys.createKey(owner.id, { name: 'before disable' });
    await keys.setAccess(actor, owner.id, false);
    expect(await prisma.apiKey.count({ where: { ownerId: owner.id, revokedAt: null } })).toBe(0);
    await keys.setAccess(actor, owner.id, true);
    await expect(keys.authenticate(created.secret)).rejects.toBeInstanceOf(UnauthorizedException);
    const audits = await prisma.auditLog.findMany({ where: { entityId: owner.id, action: 'api_access.disable' } });
    expect(audits).toHaveLength(1);
    expect((await keys.listAccounts({ q: owner.email! })).items.map((item) => item.userId)).toEqual([owner.id]);
  });

  it('fails closed for locked users and revalidates current key scopes rather than stale principal', async () => {
    const owner = await user();
    const created = await keys.createKey(owner.id, { name: 'write', scopes: ['orders:write'] });
    const principal = await keys.authenticate(created.secret);
    await expect(prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:read'))).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.apiKey.update({ where: { id: principal.keyId }, data: { scopes: ['orders:read'] } });
    await expect(prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:write'))).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.user.update({ where: { id: owner.id }, data: { lockedAt: new Date() } });
    await expect(keys.authenticate(created.secret)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:read'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rolls back approval/create/revoke if transactional audit insert fails', async () => {
    const owner = await user(false);
    // CHECK tạm trong DB dùng một lần, không sửa audit production để test dễ xanh.
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT api_test_audit_failure CHECK (action NOT LIKE 'api_%') NOT VALID`);
    try {
      await expect(keys.setAccess(actor, owner.id, true)).rejects.toThrow();
      expect(await prisma.apiAccess.findUnique({ where: { userId: owner.id } })).toBeNull();
    } finally { await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT api_test_audit_failure`); }
    await keys.setAccess(actor, owner.id, true);
    const created = await keys.createKey(owner.id, { name: 'existing' });
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD CONSTRAINT api_test_audit_failure CHECK (action NOT LIKE 'api_%') NOT VALID`);
    try {
      await expect(keys.createKey(owner.id, { name: 'rollback' })).rejects.toThrow();
      await expect(keys.revokeOwnKey(owner.id, created.key.id)).rejects.toThrow();
      await expect(keys.setAccess(actor, owner.id, false)).rejects.toThrow();
      expect(await prisma.apiKey.count({ where: { ownerId: owner.id } })).toBe(1);
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: created.key.id } })).revokedAt).toBeNull();
      expect((await prisma.apiAccess.findUniqueOrThrow({ where: { userId: owner.id } })).enabled).toBe(true);
    } finally { await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DROP CONSTRAINT api_test_audit_failure`); }
  });

  it('access/key share lock lets in-flight transaction finish before disable commits', async () => {
    const owner = await user(); const created = await keys.createKey(owner.id, { name: 'race', scopes: ['orders:write'] });
    const principal = await keys.authenticate(created.secret);
    const held = latch(); const release = latch(); const events: string[] = [];
    const mutation = prisma.$transaction(async (tx) => {
      await keys.revalidateInTransaction(tx, principal, 'orders:write');
      held.release(); await release.promise; events.push('mutation');
    });
    await held.promise;
    const disable = keys.setAccess(actor, owner.id, false).then(() => { events.push('disable'); });
    let blocked = false;
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query LIKE '%ApiAccess%'
          ) AS blocked
        `;
        if (state.blocked) { blocked = true; break; }
        if (events.includes('disable')) break;
      }
    } finally { release.release(); }
    await Promise.all([mutation, disable]);
    expect(blocked).toBe(true);
    expect(events).toEqual(['mutation', 'disable']);
    await expect(prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:write'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('revalidation started while disable holds its locks sees the committed revocation', async () => {
    const owner = await user(); const created = await keys.createKey(owner.id, { name: 'revoke wins' });
    const principal = await keys.authenticate(created.secret);
    const held = latch(); const release = latch();
    const disable = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "ApiAccess" WHERE "userId" = ${owner.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "ApiKey" WHERE "ownerId" = ${owner.id} ORDER BY "id" FOR UPDATE`;
      await tx.apiAccess.update({ where: { userId: owner.id }, data: { enabled: false, disabledAt: new Date() } });
      await tx.apiKey.updateMany({ where: { ownerId: owner.id, revokedAt: null }, data: { revokedAt: new Date() } });
      held.release(); await release.promise;
    });
    await held.promise;
    const revalidation = prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:read'));
    const outcome = expect(revalidation).rejects.toBeInstanceOf(ForbiddenException);
    let blocked = false;
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
              AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%ApiAccess%'
          ) AS blocked
        `;
        if (state.blocked) { blocked = true; break; }
      }
    } finally { release.release(); }
    await Promise.all([disable, outcome]);
    expect(blocked).toBe(true);
  });

  it('single-key revocation serialized before revalidation blocks subsequent mutation', async () => {
    const owner = await user(); const created = await keys.createKey(owner.id, { name: 'race' });
    const principal = await keys.authenticate(created.secret);
    await keys.revokeAdminKey(actor, created.key.id);
    await expect(prisma.$transaction((tx) => keys.revalidateInTransaction(tx, principal, 'orders:read'))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(keys.setAccess({ ...actor, id: owner.id }, owner.id, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not approve using stale SUPERADMIN role while actor demotion commits', async () => {
    const owner = await user(false);
    const manager = await prisma.user.create({ data: { code: nextCode++, email: `${randomUUID()}@api-key.test`, role: 'SUPERADMIN', passwordHash: 'not-a-login-password' } });
    const held = latch(); const release = latch();
    const demotion = prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: manager.id }, data: { role: 'USER' } });
      held.release(); await release.promise;
    });
    await held.promise;
    const approval = keys.setAccess(manager, owner.id, true);
    const outcome = expect(approval).rejects.toBeInstanceOf(ForbiddenException);
    let blocked = false;
    try {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const [state] = await prisma.$queryRaw<{ blocked: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
              AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%User%'
          ) AS blocked
        `;
        if (state.blocked) { blocked = true; break; }
      }
    } finally { release.release(); }
    await Promise.all([demotion, outcome]);
    expect(blocked).toBe(true);
    expect(await prisma.apiAccess.findUnique({ where: { userId: owner.id } })).toBeNull();
  });

  it('distributed POST owner quota remains atomic across key rotation and service instances', async () => {
    const owner = await user();
    const otherQuota = new ApiQuotaService(prisma as PrismaService);
    const results = await Promise.allSettled(Array.from({ length: 45 }, (_, i) => (i % 2 ? quota : otherQuota).consumeRequest({ ownerId: owner.id, keyId: `key-${i}`, scopes: [] }, 'POST')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(30);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(15);
    expect((await prisma.apiRateBucket.findFirstOrThrow({ where: { id: { startsWith: `owner:${owner.id}:write:` } } })).hits).toBe(45);
  });
});
