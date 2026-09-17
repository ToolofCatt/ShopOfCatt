import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
  $disconnect: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ PrismaClient: class { constructor() { return db; } } }));
// Import seed không được đọc .env thật hay tự tạo chủ shop trong bài kiểm tra.
vi.mock('node:fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));

import { seedUsers } from '../../prisma/seed';

describe('seed owner password guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.user.findUnique.mockResolvedValue({ code: 12345678 });
    db.user.create.mockResolvedValue({ code: 12345678 });
    vi.stubEnv('ADMIN_EMAIL', 'fixture@example.test');
    vi.stubEnv('SEED_DEMO', 'false');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([
    'mat-khau-manh-cua-ban',
    '  MAT-KHAU-MANH-CUA-BAN  ',
    'dat-mat-khau-manh-cua-ban',
    'admin@123', 'change-me', 'changeme', 'password', 'User@123',
  ])('rejects the public sample %s before any database write', async (sample) => {
    vi.stubEnv('ADMIN_PASSWORD', sample);
    await expect(seedUsers()).rejects.toThrow(/mẫu công khai/);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing credentials without creating an owner', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    await expect(seedUsers()).rejects.toThrow(/Thiếu ADMIN_PASSWORD/);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('leaves an existing user password and role untouched on rerun', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'fixture-new-password-123');
    db.user.findUnique.mockResolvedValue({ code: 12345678 });
    await seedUsers();
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'fixture@example.test' }, select: { code: true },
    });
    // Không cung cấp update/upsert trong adapter: đổi role/hash cũng phải làm test hỏng.
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('creates a missing owner with a private password hash', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'fixture-private-password-456');
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ code: 12345678 });
    await seedUsers();
    expect(db.user.create).toHaveBeenCalledOnce();
    expect(db.user.create).toHaveBeenCalledWith({
      data: {
        email: 'fixture@example.test', role: 'SUPERADMIN', code: expect.any(Number),
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
      }, select: { code: true },
    });
  });
});
