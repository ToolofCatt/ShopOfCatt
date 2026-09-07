import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { User } from '@prisma/client';
import {
  TELEGRAM_ADMIN_PERMISSIONS,
  type TelegramAdminPermission,
} from '@webcatt/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { TelegramAdminAccessService } from './access.service';
import { renderAdminPreview } from './views';
import { K } from '../i18n/messages';

class AccessInput {
  @IsString() telegramUserId: string;
  @IsString() @MaxLength(100) name: string;
  @IsIn(TELEGRAM_ADMIN_PERMISSIONS) permission: TelegramAdminPermission;
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
class EnabledInput {
  @IsBoolean() enabled: boolean;
}

@Controller('admin/telegram/admins')
@UseGuards(JwtAuthGuard, SuperAdminGuard, RateLimitGuard)
@RateLimit({ limit: 60, windowMs: 60000, name: 'telegram-admin-access' })
export class TelegramAdminAccessController {
  constructor(private readonly access: TelegramAdminAccessService) {}
  @Get() list() {
    return this.access.list();
  }
  @Post('actions/:id/reviewed')
  reviewed(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.access.acknowledge(actor, id);
  }
  @Patch('settings') enable(
    @CurrentUser() actor: User,
    @Body() input: EnabledInput,
  ) {
    return this.access.enable(actor, input.enabled);
  }
  @Post() add(@CurrentUser() actor: User, @Body() input: AccessInput) {
    return this.access.save(actor, input);
  }
  @Patch(':id') update(
    @CurrentUser() actor: User,
    @Param('id') id: string,
    @Body() input: AccessInput,
  ) {
    return this.access.save(actor, input, id);
  }
  @Delete(':id') remove(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.access.remove(actor, id);
  }
}

@Controller('admin/telegram/management-preview')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TelegramAdminPreviewController {
  @Get() preview(
    @Query('lang') lang = 'vi',
    @Query('permission') permission = 'OPERATOR',
    @Query('screen') screen = 'home',
  ) {
    if (
      !['vi', 'en', 'zh'].includes(lang) ||
      !TELEGRAM_ADMIN_PERMISSIONS.includes(
        permission as TelegramAdminPermission,
      )
    )
      throw new BadRequestException(K.forbidden);
    return renderAdminPreview(
      lang as 'vi' | 'en' | 'zh',
      permission as TelegramAdminPermission,
      screen,
    );
  }
}
