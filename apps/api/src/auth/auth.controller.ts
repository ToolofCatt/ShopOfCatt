import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthResponse, CaptchaDto, PublicUser } from '@webcatt/shared';
import type { Request } from 'express';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { clientIp } from '../security/rate-limit.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { toPublicUser } from './user.mapper';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Câu hỏi xác minh cho form đăng ký (chống đăng ký hàng loạt). */
  @Get('captcha')
  captcha(@Req() request: Request): CaptchaDto {
    return this.authService.issueCaptcha(clientIp(request));
  }

  @Post('register')
  register(
    @Req() request: Request,
    @Body() dto: RegisterDto,
  ): Promise<AuthResponse> {
    return this.authService.register(dto, clientIp(request));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Req() request: Request,
    @Body() dto: LoginDto,
  ): Promise<AuthResponse> {
    return this.authService.login(dto, clientIp(request));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User): PublicUser {
    return toPublicUser(user);
  }

  // Mỗi lần gọi chạy bcrypt hai lượt — vừa là công cụ dò mật khẩu hiện tại,
  // vừa là đòn bẩy làm nghẽn CPU nếu bắn dồn.
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 15 * 60_000 })
  changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean; accessToken: string }> {
    return this.authService.changePassword(user, dto);
  }
}
