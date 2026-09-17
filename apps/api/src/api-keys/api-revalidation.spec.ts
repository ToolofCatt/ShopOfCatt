import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaService } from './api-quota.service';

function fixture() {
  const access: { enabled: boolean }[] = [{ enabled: true }];
  const key = { ownerId: 'owner', scopes: ['orders:write'], revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) };
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?'); calls.push(sql);
      if (sql.includes('"ApiAccess"')) return access;
      return [key];
    }),
    user: { findUnique: vi.fn(async () => { calls.push('User read'); return { lockedAt: null as Date | null }; }) },
  };
  const prisma = {} as PrismaService;
  const service = new ApiKeysService(prisma, new ApiQuotaService(prisma));
  const principal = { ownerId: 'owner', keyId: 'key', scopes: ['orders:write'] as const };
  const check = (scope: 'orders:write' | 'orders:read' = 'orders:write') => service.revalidateInTransaction(tx as unknown as Prisma.TransactionClient, { ...principal, scopes: [...principal.scopes] }, scope);
  return { access, key, calls, tx, check };
}

describe('API transaction authorization', () => {
  it('locks approval before key using SHARE, then checks user without taking User locks', async () => {
    const f = fixture(); await expect(f.check()).resolves.toBeUndefined();
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]).toMatch(/ApiAccess.*FOR SHARE/s);
    expect(f.calls[1]).toMatch(/ApiKey.*FOR SHARE/s);
    expect(f.calls[2]).toBe('User read');
  });

  it.each(['missing', 'disabled'] as const)('rejects %s approval before touching key rows', async (state) => {
    const f = fixture();
    if (state === 'missing') f.access.splice(0); else f.access[0].enabled = false;
    await expect(f.check()).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.calls).toHaveLength(1);
  });

  it.each(['expired', 'revoked', 'foreign'] as const)('rejects %s key using current DB state', async (state) => {
    const f = fixture();
    if (state === 'expired') f.key.expiresAt = new Date(Date.now() - 1);
    if (state === 'revoked') f.key.revokedAt = new Date();
    if (state === 'foreign') f.key.ownerId = 'other';
    await expect(f.check()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(f.tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('does not trust scopes captured by the outer guard', async () => {
    const f = fixture(); f.key.scopes = ['orders:read'];
    await expect(f.check()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(f.check('orders:read')).resolves.toBeUndefined();
  });

  it('rejects a locked user after checking key and approval', async () => {
    const f = fixture(); f.tx.user.findUnique.mockResolvedValue({ lockedAt: new Date() });
    await expect(f.check()).rejects.toBeInstanceOf(ForbiddenException);
  });
});
