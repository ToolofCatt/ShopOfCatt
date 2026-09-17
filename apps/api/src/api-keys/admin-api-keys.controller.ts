import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { ApiAccessDto, ApiAccountDto, ApiKeyDto, Paginated } from '@webcatt/shared';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { ApiKeysService } from './api-keys.service';
import { ApiAccountsQueryDto, SetApiAccessDto } from './dto/api-keys.dto';

@Controller('admin/api')
@UseGuards(JwtAuthGuard, AdminGuard, RateLimitGuard)
@RateLimit({ limit: 60, windowMs: 60_000, name: 'admin-api-keys' })
export class AdminApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get('accounts')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ApiAccountsQueryDto): Promise<Paginated<ApiAccountDto>> {
    return this.keys.listAccounts(query);
  }

  @Patch('accounts/:userId')
  @UseGuards(SuperAdminGuard)
  @Header('Cache-Control', 'no-store')
  setAccess(@CurrentUser() actor: User, @Param('userId') userId: string, @Body() input: SetApiAccessDto): Promise<ApiAccessDto> {
    return this.keys.setAccess(actor, userId, input.enabled);
  }

  @Get('accounts/:userId/keys')
  @Header('Cache-Control', 'no-store')
  listKeys(@Param('userId') userId: string): Promise<ApiKeyDto[]> {
    return this.keys.listAccountKeys(userId);
  }

  @Delete('keys/:id')
  @UseGuards(SuperAdminGuard)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async revoke(@CurrentUser() actor: User, @Param('id') id: string): Promise<void> {
    await this.keys.revokeAdminKey(actor, id);
  }
}
