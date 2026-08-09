/**
 * Xuất phần cấu hình do chủ shop tự nhập (tài khoản chủ, cấu hình thanh toán,
 * kênh hỗ trợ, hộp thông báo) ra JSON — để khôi phục sau khi tạo lại CSDL.
 *
 *   pnpm --filter @webcatt/api settings:export
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(__dirname, '../../../backups/store-settings.json');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      owner: await prisma.user.findFirst({
        where: { role: 'SUPERADMIN' },
        orderBy: { createdAt: 'asc' },
      }),
      storeSetting: await prisma.storeSetting.findUnique({
        where: { id: 'main' },
      }),
      announcement: await prisma.announcement.findUnique({
        where: { id: 'main' },
      }),
      announcementTranslations: await prisma.announcementTranslation.findMany(),
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Đã xuất cấu hình → ${OUT}`);
    console.log(`  chủ shop:  ${payload.owner?.email ?? '(không có)'}`);
    console.log(`  thông báo: "${payload.announcement?.title ?? ''}"`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
