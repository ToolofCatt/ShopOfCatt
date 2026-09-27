import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

describe('public product reads', () => {
  it('does not enter the financial transaction path', async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      product: { findMany },
      $transaction: () => { throw new Error('public read acquired financial lock'); },
    } as unknown as PrismaService;
    const service = new ProductsService(prisma);
    expect(await service.list('vi')).toEqual([]);
    expect(findMany).toHaveBeenCalledOnce();
  });
});
