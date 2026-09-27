import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { CustomersService } from './customers.service';

describe('customer password reset authorization', () => {
  it('does not reset a customer who became ADMIN before the password write', async () => {
    const target = { id: 'customer', role: 'USER', email: 'buyer@example.test', telegramName: '', code: 12345678, lockedAt: null };
    let wrote = false;
    const prisma = {
      user: {
        findUnique: async () => ({ ...target, _count: { orders: 0 } }),
        updateMany: async ({ where }: { where: { role?: string } }) => {
          expect(where.role).toBe('USER');
          return { count: 0 };
        },
        update: async () => { wrote = true; return target; },
      },
    } as unknown as PrismaService;
    const service = new CustomersService(prisma, { log: async () => {} } as unknown as AuditService);
    await expect(service.resetPassword({ id: 'operator', role: 'ADMIN' } as never, target.id)).rejects.toThrow();
    expect(wrote).toBe(false);
  });
});
