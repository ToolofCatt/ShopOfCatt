import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { K } from '../i18n/messages';
import { RateLimitService, clientIp } from './rate-limit.service';

export const RATE_LIMIT_KEY = 'wc:rate-limit';

export interface RateLimitOptions {
  /** Số lần tối đa trong một cửa sổ. */
  limit: number;
  /** Độ dài cửa sổ, tính bằng mili giây. */
  windowMs: number;
  /** Tên riêng của "xô" đếm — mặc định lấy theo đường dẫn route. */
  name?: string;
}

/**
 * Giới hạn tần suất cho một route.
 *
 *   @RateLimit({ limit: 30, windowMs: 60_000 })
 *   @Post()
 *   create() { ... }
 *
 * Khóa đếm ưu tiên ID người dùng đã đăng nhập, chỉ dùng IP khi ẩn danh: nhiều
 * khách chung một đường mạng (quán net, 4G, văn phòng) không nên chặn lẫn nhau.
 */
export function RateLimit(options: RateLimitOptions): CustomDecorator<string> {
  return SetMetadata(RATE_LIMIT_KEY, options);
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest<
      Request & { user?: User }
    >();
    const scope =
      options.name ?? `${request.method}:${request.route?.path ?? request.path}`;
    const who = request.user?.id ?? `ip:${clientIp(request)}`;

    if (!this.rateLimit.hit(`${scope}|${who}`, options.limit, options.windowMs)) {
      throw new HttpException(K.tooManyRequests, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
