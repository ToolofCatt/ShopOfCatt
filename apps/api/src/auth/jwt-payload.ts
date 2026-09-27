import type { Role } from '@webcatt/shared';

export interface JwtPayload {
  sub: string;
  /** Token chỉ cấp qua đăng nhập web nên thực tế luôn có email; kiểu null hoá
   *  theo cột CSDL từ khi có khách Telegram (không mật khẩu, không token). */
  email: string | null;
  role: Role;
  /** Phiên quyền/mật khẩu trong DB; token cũ thiếu trường này phải đăng nhập lại. */
  sessionVersion: number;
  /** Thời điểm cấp token (giây) — jsonwebtoken tự thêm khi ký. */
  iat?: number;
}
