import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { FulfillmentService } from '../orders/fulfillment.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';
import type { TranslationService } from '../translation/translation.service';
import { AdminService } from './admin.service';

describe('AdminService.getStats', () => {
  it('đưa variant còn đúng ngưỡng vào cảnh báo kho thấp', async () => {
    const prisma = {
      order: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { totalAmount: null } }),
        count: vi.fn().mockResolvedValue(0),
      },
      product: { count: vi.fn().mockResolvedValue(1) },
      user: { count: vi.fn().mockResolvedValue(0) },
      productVariant: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'at-threshold',
            name: 'Còn 5',
            productId: 'product-1',
            product: { name: 'Sản phẩm' },
          },
          {
            id: 'above-threshold',
            name: 'Còn 6',
            productId: 'product-1',
            product: { name: 'Sản phẩm' },
          },
        ]),
      },
      stockItem: {
        groupBy: vi.fn().mockResolvedValue([
          {
            variantId: 'at-threshold',
            status: 'AVAILABLE',
            _count: { _all: 5 },
          },
          {
            variantId: 'above-threshold',
            status: 'AVAILABLE',
            _count: { _all: 6 },
          },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const settings = {
      getReadiness: vi.fn().mockResolvedValue({}),
    };
    const service = new AdminService(
      prisma as unknown as PrismaService,
      {} as FulfillmentService,
      {} as TranslationService,
      {} as AuditService,
      settings as unknown as SettingsService,
    );

    const stats = await service.getStats();

    expect(stats.lowStock.map((row) => row.variantId)).toEqual([
      'at-threshold',
    ]);
  });
});
