import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { resolveLocaleFromHeader, type Locale } from './locale';

/**
 * Ngôn ngữ hiển thị của request, lấy từ header `Accept-Language`
 * (web gửi thẳng "vi" | "en" | "zh"). Dùng cho các endpoint công khai.
 */
export const ReqLocale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Locale => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return resolveLocaleFromHeader(request.headers['accept-language']);
  },
);
