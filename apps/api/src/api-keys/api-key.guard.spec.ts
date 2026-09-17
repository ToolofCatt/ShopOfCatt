import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { RateLimitService } from '../security/rate-limit.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ApiScope } from '@webcatt/shared';
import { ApiKeyGuard } from './api-key.guard';
import { ApiScopes } from './api-scopes.decorator';
import type { ApiKeysService } from './api-keys.service';
import type { ApiQuotaService } from './api-quota.service';
import { ApiQuotaExceeded } from './api-quota.service';
import { createApiKeyMaterial, formatApiKey } from './api-key.crypto';

function harness(scopes: ApiScope[] = ['orders:write'], required: ApiScope[] | null = ['orders:read']) {
  class Handler { handle() {} }
  if (required) ApiScopes(...required)(Handler.prototype, 'handle', Object.getOwnPropertyDescriptor(Handler.prototype, 'handle')!);
  const request: any = { headers: { authorization: 'Bearer synthetic-key' }, ip: '127.0.0.1', socket: {}, method: 'GET' };
  const response = { setHeader: vi.fn() };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    getHandler: () => Handler.prototype.handle, getClass: () => Handler,
  } as unknown as ExecutionContext;
  const keys = { authenticate: vi.fn().mockResolvedValue({ ownerId: 'owner', keyId: 'key', scopes }) };
  const quotas = { consumeRequest: vi.fn().mockResolvedValue(undefined) };
  const limits = new RateLimitService();
  const guard = new ApiKeyGuard(keys as unknown as ApiKeysService, quotas as unknown as ApiQuotaService, new Reflector(), limits);
  return { guard, request, response, context, keys, quotas };
}

describe('API-key authorization boundary', () => {
  it('does not infer read scope from write scope', async () => {
    const h = harness();
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.request.apiPrincipal).toBeUndefined();
  });

  it('sets only apiPrincipal and does not grant JWT/admin identity', async () => {
    const h = harness(['orders:read']);
    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.request.apiPrincipal).toEqual({ ownerId: 'owner', keyId: 'key', scopes: ['orders:read'] });
    expect(h.request.user).toBeUndefined();
    expect(() => new AdminGuard().canActivate(h.context)).toThrow(ForbiddenException);
    expect(() => new SuperAdminGuard().canActivate(h.context)).toThrow(ForbiddenException);
  });

  it('denies a route without explicit scope metadata', async () => {
    const h = harness(['orders:read'], null);
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([undefined, 'Basic secret', 'Bearer ', 'Bearer key extra', 'Bearer a\nsecret'])('rejects malformed authorization before key lookup', async (header) => {
    const h = harness(); h.request.headers.authorization = header;
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.keys.authenticate).not.toHaveBeenCalled();
  });

  it('limits invalid lookups by IP before another database lookup', async () => {
    const h = harness(); h.keys.authenticate.mockRejectedValue(new UnauthorizedException());
    for (let i = 0; i < 30; i++) await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({ retryAfterSeconds: 60 });
    expect(h.keys.authenticate).toHaveBeenCalledTimes(30);
    expect(h.response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('preserves distributed quota Retry-After and leaves no principal on rejection', async () => {
    const h = harness(['orders:read']); h.quotas.consumeRequest.mockRejectedValue(new ApiQuotaExceeded(17));
    await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({ retryAfterSeconds: 17 });
    expect(h.response.setHeader).toHaveBeenCalledWith('Retry-After', '17');
    expect(h.request.apiPrincipal).toBeUndefined();
  });

  it('cannot use a real API key as JWT even when its owner could be an admin', async () => {
    const h = harness();
    h.request.headers.authorization = `Bearer ${formatApiKey('cm00000000000000000000000', createApiKeyMaterial().secret)}`;
    const jwt = new JwtService({ secret: 'test-only-jwt-signing-secret-not-a-real-credential' });
    const prisma = { user: { findUnique: vi.fn() } };
    const guard = new JwtAuthGuard(jwt, prisma as unknown as PrismaService);
    await expect(guard.canActivate(h.context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
