import type { Role } from '@webcatt/shared';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  /** Thời điểm cấp token (giây) — jsonwebtoken tự thêm khi ký. */
  iat?: number;
}
