import type { User } from '@prisma/client';
import type { PublicUser } from '@webcatt/shared';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    code: user.code,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
