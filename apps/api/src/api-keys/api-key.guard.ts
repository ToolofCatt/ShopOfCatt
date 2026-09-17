import {
  ForbiddenException, Injectable, UnauthorizedException,
  type CanActivate, type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiScope } from '@webcatt/shared';
import type { Response } from 'express';
import { K } from '../i18n/messages';
import { RateLimitService, clientIp } from '../security/rate-limit.service';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaExceeded, ApiQuotaService } from './api-quota.service';
import { API_SCOPES_METADATA } from './api-scopes.decorator';
import type { RequestWithApiPrincipal } from './api-principal';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: ApiKeysService,
    private readonly quotas: ApiQuotaService,
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiPrincipal>();
    const response = context.switchToHttp().getResponse<Response>();
    const ipBucket = `api-key:lookup:${clientIp(request)}`;
    try {
      // Đếm trước lookup để ID rác không gây truy vấn DB vô hạn; thành công xóa bucket.
      if (!this.limits.hit(ipBucket, 30, 60_000)) throw new ApiQuotaExceeded(60);
      const header = request.headers.authorization;
      const match = typeof header === 'string' && /^Bearer ([^\s]+)$/i.exec(header);
      if (!match) throw new UnauthorizedException(K.apiKeyInvalid);
      const principal = await this.keys.authenticate(match[1]);
      this.limits.reset(ipBucket);
      // Quota tính cả request thiếu scope, nhưng không gán principal trước khi đủ quyền.
      await this.quotas.consumeRequest(principal, request.method);
      const scopes = this.reflector.getAllAndOverride<ApiScope[]>(API_SCOPES_METADATA, [
        context.getHandler(), context.getClass(),
      ]);
      if (!scopes?.length || scopes.some((scope) => !principal.scopes.includes(scope))) {
        throw new ForbiddenException(K.apiScopeRequired);
      }
      // Không gán request.user: key của SUPERADMIN cũng không phải phiên JWT quản trị.
      request.apiPrincipal = principal;
      return true;
    } catch (error) {
      if (error instanceof ApiQuotaExceeded) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }
}
