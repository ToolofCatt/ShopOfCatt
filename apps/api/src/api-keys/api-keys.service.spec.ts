import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaService } from './api-quota.service';
import { createApiKeyMaterial, formatApiKey } from './api-key.crypto';

const ID = 'cm00000000000000000000000';
function fixture() {
  const material = createApiKeyMaterial();
  const row = {
    id: ID, ownerId: 'owner', digest: material.digest, scopes: ['orders:write'],
    expiresAt: new Date(Date.now() + 60_000), revokedAt: null as Date | null,
    lastUsedAt: new Date(), owner: { lockedAt: null as Date | null, apiAccess: { enabled: true } as { enabled: boolean } | null },
  };
  const prisma = { apiKey: { findUnique: vi.fn().mockResolvedValue(row), updateMany: vi.fn(async (_args: Prisma.ApiKeyUpdateManyArgs) => ({ count: 1 })) } };
  return { row, prisma, service: new ApiKeysService(prisma as unknown as PrismaService, new ApiQuotaService(prisma as unknown as PrismaService)), raw: formatApiKey(ID, material.secret) };
}

describe('API-key authentication service', () => {
  it('rejects invalid creation input before consuming quota or opening a transaction', async () => {
    const prisma = {} as PrismaService;
    const quota = new ApiQuotaService(prisma);
    const hit = vi.spyOn(quota, 'consumeCreation');
    const service = new ApiKeysService(prisma, quota);
    for (const input of [
      { name: '' }, { name: 'bot', scopes: [] }, { name: 'bot', scopes: ['admin'] },
      { name: 'bot', scopes: null }, { name: 'bot', expiresInDays: null },
      { name: 'bot', scopes: ['orders:read', 'orders:read'] }, { name: 'bot', expiresInDays: 91 },
    ]) await expect(service.createKey('owner', input as never)).rejects.toMatchObject({ status: 400 });
    expect(hit).not.toHaveBeenCalled();
  });

  it('rejects non-string query search input with an i18n 400 instead of TypeError', async () => {
    const prisma = {} as PrismaService;
    const service = new ApiKeysService(prisma, new ApiQuotaService(prisma));
    for (const q of [null, 1, {}, ['owner']]) {
      await expect(service.listAccounts({ q } as never)).rejects.toMatchObject({ status: 400 });
    }
  });

  it('returns an owner-scoped principal without role/digest/secret', async () => {
    const f = fixture();
    const principal = await f.service.authenticate(f.raw);
    expect(principal).toEqual({ ownerId: 'owner', keyId: ID, scopes: ['orders:write'] });
    expect(JSON.stringify(principal)).not.toContain(f.raw);
    expect(JSON.stringify(principal)).not.toContain(f.row.digest);
  });

  it.each(['jwt.token.example', 'catt_wrong.token', ''])('rejects malformed input without database lookup', async (raw) => {
    const f = fixture();
    await expect(f.service.authenticate(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('rejects wrong secret without exposing account approval state', async () => {
    const f = fixture(); f.row.owner.apiAccess = null;
    await expect(f.service.authenticate(formatApiKey(ID, createApiKeyMaterial().secret))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['expired', 'revoked', 'missing'] as const)('rejects %s credentials', async (state) => {
    const f = fixture();
    if (state === 'expired') f.row.expiresAt = new Date(Date.now() - 1);
    if (state === 'revoked') f.row.revokedAt = new Date();
    if (state === 'missing') f.prisma.apiKey.findUnique.mockResolvedValue(null);
    await expect(f.service.authenticate(f.raw)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['unapproved', 'disabled', 'locked'] as const)('rejects %s owner', async (state) => {
    const f = fixture();
    if (state === 'unapproved') f.row.owner.apiAccess = null;
    if (state === 'disabled') f.row.owner.apiAccess = { enabled: false };
    if (state === 'locked') f.row.owner.lockedAt = new Date();
    await expect(f.service.authenticate(f.raw)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never upgrades unknown stored scope values', async () => {
    const f = fixture(); f.row.scopes = ['admin', 'orders:write'];
    expect((await f.service.authenticate(f.raw)).scopes).toEqual(['orders:write']);
  });

  it('throttles last-used writes and never writes credentials', async () => {
    const f = fixture();
    await f.service.authenticate(f.raw);
    expect(f.prisma.apiKey.updateMany).not.toHaveBeenCalled();
    f.row.lastUsedAt = new Date(Date.now() - 120_000);
    await f.service.authenticate(f.raw);
    const args = f.prisma.apiKey.updateMany.mock.calls[0][0];
    expect(args.data).toEqual({ lastUsedAt: expect.any(Date) });
    expect(args.where).toMatchObject({ id: ID, revokedAt: null });
    expect(JSON.stringify(args)).not.toContain(f.raw);
  });
});
