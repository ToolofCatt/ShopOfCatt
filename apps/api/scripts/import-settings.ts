/**
 * Khôi phục cấu hình đã xuất bằng `settings:export` vào một CSDL vừa tạo lại.
 * An toàn khi chạy lại: mọi thao tác đều là upsert.
 *
 *   pnpm --filter @webcatt/api settings:import
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const IN = resolve(__dirname, '../../../backups/store-settings.json');

interface Dump {
  owner: {
    email: string;
    code: number;
    passwordHash: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
    passwordChangedAt: string | null;
  } | null;
  storeSetting: Record<string, unknown> | null;
  announcement: { active: boolean; title: string; body: string } | null;
  announcementTranslations: Array<{
    locale: string;
    title: string;
    body: string;
  }>;
}

async function main(): Promise<void> {
  const dump = JSON.parse(readFileSync(IN, 'utf8')) as Dump;
  const prisma = new PrismaClient();
  try {
    if (dump.owner) {
      const { email, code, passwordHash, role, passwordChangedAt } = dump.owner;
      await prisma.user.upsert({
        where: { email },
        create: {
          email,
          code,
          passwordHash,
          role,
          passwordChangedAt: passwordChangedAt
            ? new Date(passwordChangedAt)
            : null,
        },
        update: {},
      });
      console.log(`✔ Chủ cửa hàng: ${email} (mã #${code})`);
    }

    if (dump.storeSetting) {
      const s = dump.storeSetting;
      const data = {
        mockEnabled: Boolean(s.mockEnabled),
        binancePayEnabled: Boolean(s.binancePayEnabled),
        cryptoEnabled: Boolean(s.cryptoEnabled),
        bep20Address: String(s.bep20Address ?? ''),
        trc20Address: String(s.trc20Address ?? ''),
        supportChannels: (s.supportChannels ?? []) as Prisma.InputJsonValue,
        supportNote: String(s.supportNote ?? ''),
      };
      await prisma.storeSetting.upsert({
        where: { id: 'main' },
        create: { id: 'main', ...data },
        update: data,
      });
      console.log('✔ Cấu hình thanh toán + kênh hỗ trợ');
    }

    if (dump.announcement) {
      const { active, title, body } = dump.announcement;
      await prisma.announcement.upsert({
        where: { id: 'main' },
        create: { id: 'main', active, title, body },
        update: { active, title, body },
      });
      for (const row of dump.announcementTranslations) {
        await prisma.announcementTranslation.upsert({
          where: {
            announcementId_locale: {
              announcementId: 'main',
              locale: row.locale,
            },
          },
          create: {
            announcementId: 'main',
            locale: row.locale,
            title: row.title,
            body: row.body,
          },
          update: { title: row.title, body: row.body },
        });
      }
      console.log(`✔ Thông báo: "${title}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
