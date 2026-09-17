import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ApiQuotaExceeded, ApiQuotaService } from './api-quota.service';

function harness(hits: number[]) {
  const sql: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?'));
      return [{ hits: hits.shift() ?? 1, retryAfterSeconds: 17 }];
    }),
    $executeRaw: vi.fn(async () => 0),
  };
  const prisma = { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)) };
  return { service: new ApiQuotaService(prisma as unknown as PrismaService), prisma, tx, sql };
}
const principal = { ownerId: 'owner', keyId: 'key', scopes: [] };

describe('PostgreSQL API quota contract', () => {
  it('allows the GET boundary and rejects next request with Retry-After', async () => {
    const h = harness([120, 240, 121, 241]);
    await expect(h.service.consumeRequest(principal, 'GET')).resolves.toBeUndefined();
    await expect(h.service.consumeRequest(principal, 'GET')).rejects.toBeInstanceOf(ApiQuotaExceeded);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(h.sql.every((sql) => sql.includes('ON CONFLICT') && sql.includes('RETURNING'))).toBe(true);
  });

  it('enforces owner POST limits across key rotation', async () => {
    const h = harness([1, 31]);
    await expect(h.service.consumeRequest(principal, 'POST')).rejects.toMatchObject({ retryAfterSeconds: expect.any(Number) });
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('enforces 5 key-creation attempts per hour independently of request quotas', async () => {
    const h = harness([5, 6]);
    await expect(h.service.consumeCreation('owner')).resolves.toBeUndefined();
    await expect(h.service.consumeCreation('owner')).rejects.toBeInstanceOf(ApiQuotaExceeded);
  });
});
