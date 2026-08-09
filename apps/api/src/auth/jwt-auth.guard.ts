import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload';
import { K } from '../i18n/messages';

export interface RequestWithUser extends Request {
  user: User;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException(K.loginRequired);
    }
    const token = header.slice('Bearer '.length).trim();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException(
        K.sessionInvalid,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException(
        K.sessionInvalid,
      );
    }
    // Tài khoản bị khóa → token đang có cũng mất hiệu lực ngay lập tức
    if (user.lockedAt) {
      throw new ForbiddenException(K.accountLocked);
    }
    // Đổi/đặt lại mật khẩu → mọi token cấp trước đó hết hiệu lực.
    // `iat` tính theo giây (làm tròn xuống) nên cộng 1 giây dung sai để token
    // vừa cấp ngay sau khi đổi mật khẩu không bị loại oan.
    if (
      user.passwordChangedAt &&
      typeof payload.iat === 'number' &&
      payload.iat * 1000 + 1000 < user.passwordChangedAt.getTime()
    ) {
      throw new UnauthorizedException(K.sessionInvalid);
    }

    request.user = user;
    return true;
  }
}
