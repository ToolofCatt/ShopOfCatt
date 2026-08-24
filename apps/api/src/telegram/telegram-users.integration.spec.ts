import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { TelegramUsersService } from './telegram-users.service';

/**
 * Test TÍCH HỢP trên PostgreSQL thật, theo đúng khuôn của
 * fulfillment.integration.spec: khách Telegram là một `User` với email NULL —
 * ràng buộc unique-nhiều-NULL và nhánh đua P2002 chỉ tồn tại trong CSDL, mock
 * sẽ "đạt" kể cả khi schema sai.
 *
 * Suite tự BỎ QUA khi không có PostgreSQL (chưa chạy `pnpm db:embedded`).
 */

const BASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/webcatt?schema=public';
const TEST_DB = 'webcatt_telegram_users_test';

function urlForDatabase(database: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

function newClient(database: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: urlForDatabase(database) } },
  });
}

async function isPostgresReachable(): Promise<boolean> {
  const admin = newClient('postgres');
  try {
    await admin.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await admin.$disconnect();
  }
}

let reachable = false;
let prisma: PrismaClient;
let service: TelegramUsersService;

function itDb(name: string, fn: () => Promise<void>, timeout?: number): void {
  it(
    name,
    async (ctx) => {
      if (!reachable) {
        ctx.skip();
        return;
      }
      await fn();
    },
    timeout,
  );
}

/** Chạy migration theo thứ tự — xem chú thích ở fulfillment.integration.spec. */
async function applyMigrations(client: PrismaClient): Promise<void> {
  const dir = resolve(__dirname, '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await client.$executeRawUnsafe(statement);
    }
  }
}

beforeAll(async () => {
  reachable = await isPostgresReachable();
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      `[telegram-users] Bỏ qua test tích hợp: không kết nối được PostgreSQL tại ${
        new URL(BASE_URL).host
      }. Chạy "pnpm db:embedded" rồi thử lại.`,
    );
    return;
  }
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.$disconnect();
  }
  prisma = newClient(TEST_DB);
  await applyMigrations(prisma);
  service = new TelegramUsersService(prisma as unknown as PrismaService);
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  await prisma.$disconnect();
  const admin = newClient('postgres');
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
});

describe('TelegramUsersService (tích hợp)', () => {
  itDb('tạo khách mới: email null, có mã số, mật khẩu không đăng nhập được', async () => {
    const user = await service.findOrCreate(111222333, 'An (@an123)', 'vi');
    expect(user.email).toBeNull();
    expect(user.telegramChatId).toBe('111222333');
    expect(user.telegramName).toBe('An (@an123)');
    expect(user.code).toBeGreaterThan(0);
    // Hash bcrypt thật nhưng của chuỗi ngẫu nhiên đã vứt — mọi mật khẩu đều trượt.
    expect(user.passwordHash.startsWith('$2')).toBe(true);
    expect(bcrypt.compareSync('', user.passwordHash)).toBe(false);
    expect(bcrypt.compareSync('123456', user.passwordHash)).toBe(false);
  });

  itDb('gọi lại cùng chat → trả đúng bản ghi cũ, không tạo trùng', async () => {
    const lanHai = await service.findOrCreate(111222333, 'An (@an123)', 'vi');
    const soKhach = await prisma.user.count({
      where: { telegramChatId: '111222333' },
    });
    expect(soKhach).toBe(1);
    expect(lanHai.telegramChatId).toBe('111222333');
  });

  itDb('tên Telegram đổi → cập nhật, vẫn một bản ghi', async () => {
    const doiTen = await service.findOrCreate(111222333, 'An Mới (@an123)', 'vi');
    expect(doiTen.telegramName).toBe('An Mới (@an123)');
    expect(await prisma.user.count({ where: { telegramChatId: '111222333' } })).toBe(1);
  });

  itDb('ngôn ngữ đổi → cập nhật cho vòng đẩy key nói đúng thứ tiếng', async () => {
    const doiNgonNgu = await service.findOrCreate(111222333, 'An Mới (@an123)', 'zh');
    expect(doiNgonNgu.telegramLang).toBe('zh');
  });

  itDb('hai chat khác nhau đều email null — unique cho nhiều NULL không vướng nhau', async () => {
    const khach2 = await service.findOrCreate(444555666, 'Bình', 'en');
    expect(khach2.email).toBeNull();
    expect(khach2.telegramChatId).toBe('444555666');
    expect(await prisma.user.count({ where: { email: null } })).toBe(2);
  });

  itDb(
    'hai lượt tạo CÙNG chat chạy song song → đúng một bản ghi (nhánh đua P2002)',
    async () => {
      const [a, b] = await Promise.all([
        service.findOrCreate(777888999, 'Đua 1', 'vi'),
        service.findOrCreate(777888999, 'Đua 2', 'vi'),
      ]);
      expect(a.id).toBe(b.id);
      expect(await prisma.user.count({ where: { telegramChatId: '777888999' } })).toBe(1);
    },
    30_000,
  );
});
