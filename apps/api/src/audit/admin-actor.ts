import type { User } from '@prisma/client';

/** Actor Telegram không có User/FK và không được cấp SUPERADMIN ngầm. */
export type AdminActor = Pick<User, 'email' | 'code' | 'role'> & {
  id: string | null;
  telegramUserId?: string;
  telegramName?: string;
};
