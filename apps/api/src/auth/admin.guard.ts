import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isAdminRole } from '@webcatt/shared';
import type { RequestWithUser } from './jwt-auth.guard';
import { K } from '../i18n/messages';

/** ADMIN và SUPERADMIN đều vào được khu vực quản trị. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || !isAdminRole(request.user.role)) {
      throw new ForbiddenException(K.forbidden);
    }
    return true;
  }
}
