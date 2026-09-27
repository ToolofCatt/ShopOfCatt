import { describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { PrismaService } from '../prisma/prisma.service';

describe('JWT password revocation', () => {
  it('rejects a token issued before a password change in the same second', async () => {
    const jwt = new JwtService({ secret: 'fixture-secret' });
    const issuedAt = Math.floor(Date.now() / 1000);
    const user = { id: 'buyer', lockedAt: null, sessionVersion: 1, passwordChangedAt: new Date(issuedAt * 1000 + 500) } as User;
    const prisma = { user: { findUnique: async () => user } } as unknown as PrismaService;
    const guard = new JwtAuthGuard(jwt, prisma);
    const token = jwt.sign({ sub: user.id, email: 'buyer@example.test', role: 'USER', iat: issuedAt, sessionVersion: 0 });
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) } as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow();
    const fresh = jwt.sign({ sub: user.id, email: 'buyer@example.test', role: 'USER', iat: issuedAt, sessionVersion: 1 });
    const current = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${fresh}` } }) }) } as ExecutionContext;
    await expect(guard.canActivate(current)).resolves.toBe(true);
  });
});
