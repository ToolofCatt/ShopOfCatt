import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaService } from './api-quota.service';

function fixture() {
  const calls: string[] = [];
  const actor = { id: 'admin', email: 'fixture@example.test', code: 71000000, role: 'SUPERADMIN', lockedAt: null };
  const audits: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?'); calls.push(sql);
      if (sql.includes('"ApiAccess"')) return [{ userId: 'owner' }];
      if (sql.includes('"ApiKey"')) return [{ id: 'key', revokedAt: null }];
      if (sql.includes('"User"')) return [actor];
      throw new Error('unexpected SQL');
    }),
    user: { findUnique: vi.fn(async () => ({ id: 'owner' })) },
    apiAccess: {
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({ enabled: false, approvedAt: new Date(0), disabledAt: new Date(1) })),
    },
    apiKey: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async (data: unknown) => { audits.push(data); return { id: 'audit' }; }) },
  };
  const prisma = { $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
  const service = new ApiKeysService(prisma as unknown as PrismaService, new ApiQuotaService(prisma as unknown as PrismaService));
  return { calls, actor, audits, tx, service };
}

describe('API-key management transactional authorization', () => {
  it('disables with access/key/actor lock order and secret-free transactional audits', async () => {
    const f = fixture();
    expect(await f.service.setAccess(f.actor, 'owner', false)).toEqual({ enabled: false, approvedAt: new Date(0).toISOString(), disabledAt: new Date(1).toISOString() });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[0]).toMatch(/ApiAccess.*FOR UPDATE/s);
    expect(f.calls[1]).toMatch(/ApiKey.*ORDER BY "id" FOR UPDATE/s);
    expect(f.calls[2]).toMatch(/User.*FOR SHARE/s);
    expect(f.audits).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ action: 'api_key.revoke', details: { ownerId: 'owner', reason: 'access_disabled' } }) }),
      expect.objectContaining({ data: expect.objectContaining({ action: 'api_access.disable', details: { enabled: false } }) }),
    ]);
  });

  it('rejects demoted actor before revoking keys or changing approval', async () => {
    const f = fixture(); f.actor.role = 'USER';
    await expect(f.service.setAccess(f.actor, 'owner', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.apiKey.updateMany).not.toHaveBeenCalled();
    expect(f.tx.apiAccess.update).not.toHaveBeenCalled();
    expect(f.audits).toHaveLength(0);
  });

  it('propagates audit failure instead of returning mutation success', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(f.service.setAccess(f.actor, 'owner', false)).rejects.toThrow('audit unavailable');
  });
});
