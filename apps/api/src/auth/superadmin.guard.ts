import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { RequestWithUser } from './jwt-auth.guard';
import { K } from '../i18n/messages';

/**
 * Chỉ chủ cửa hàng (SUPERADMIN) — dùng cho các endpoint cấp/thu hồi
 * quyền quản trị. Đặt sau JwtAuthGuard (cần req.user đã nạp).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || request.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException(K.superadminRequired);
    }
    return true;
  }
}
