import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AccountApiDto, CreatedApiKeyDto } from '@webcatt/shared';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { ApiKeysService } from './api-keys.service';
import { ApiQuotaExceeded } from './api-quota.service';
import { CreateApiKeyDto } from './dto/api-keys.dto';

@Controller('account/api-keys')
@UseGuards(JwtAuthGuard, RateLimitGuard)
@RateLimit({ limit: 60, windowMs: 60_000, name: 'account-api-keys' })
export class AccountApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  getAccount(@CurrentUser() user: User): Promise<AccountApiDto> {
    return this.keys.getAccount(user.id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@CurrentUser() user: User, @Body() input: CreateApiKeyDto, @Res({ passthrough: true }) response: Response): Promise<CreatedApiKeyDto> {
    try {
      return await this.keys.createKey(user.id, input);
    } catch (error) {
      if (error instanceof ApiQuotaExceeded) response.setHeader('Retry-After', String(error.retryAfterSeconds));
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async revoke(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    await this.keys.revokeOwnKey(user.id, id);
  }
}
