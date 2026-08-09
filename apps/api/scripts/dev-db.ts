/**
 * PostgreSQL nhúng cho môi trường dev — không cần cài Docker hay PostgreSQL.
 * Chạy:  pnpm db:embedded   (giữ cửa sổ này mở trong lúc dev)
 * Dữ liệu lưu tại apps/api/pgdata (đã gitignore).
 */
import EmbeddedPostgres from 'embedded-postgres';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATA_DIR = path.resolve(__dirname, '..', 'pgdata');
const PORT = 5433;

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
    // UTF-8 bắt buộc để lưu tiếng Việt (mặc định trên Windows là WIN1252)
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
  });

  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  if (!alreadyInitialised) {
    console.log('[dev-db] Khởi tạo cluster PostgreSQL lần đầu...');
    await pg.initialise();
  }

  console.log(`[dev-db] Đang khởi động PostgreSQL trên cổng ${PORT}...`);
  await pg.start();

  try {
    await pg.createDatabase('webcatt');
    console.log('[dev-db] Đã tạo database "webcatt".');
  } catch {
    // database đã tồn tại
  }

  console.log('[dev-db] PostgreSQL sẵn sàng: postgresql://postgres:postgres@localhost:5433/webcatt');
  console.log('[dev-db] Nhấn Ctrl+C để dừng.');

  const shutdown = async () => {
    console.log('\n[dev-db] Đang dừng PostgreSQL...');
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[dev-db] Lỗi:', err);
  process.exit(1);
});
