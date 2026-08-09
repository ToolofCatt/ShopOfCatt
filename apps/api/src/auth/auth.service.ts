import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { AuthResponse, CaptchaDto } from '@webcatt/shared';
import * as bcrypt from 'bcryptjs';
import { generateUniqueCustomerCode } from '../common/customer-code';
import { PrismaService } from '../prisma/prisma.service';
import { CaptchaService } from '../security/captcha.service';
import { RateLimitService } from '../security/rate-limit.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './jwt-payload';
import { toPublicUser } from './user.mapper';
import { K } from '../i18n/messages';

const BCRYPT_ROUNDS = 10;

/** Chống spam: số tài khoản tối đa một IP tạo được trong 1 giờ. */
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_MS = 60 * 60_000;
/** Chống dò mật khẩu: số lần đăng nhập sai trong 15 phút. */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
/** Số câu hỏi xác minh một IP xin được trong 10 phút. */
const CAPTCHA_LIMIT = 40;
const CAPTCHA_WINDOW_MS = 10 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly captcha: CaptchaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Câu hỏi xác minh cho form đăng ký. */
  issueCaptcha(ip: string): CaptchaDto {
    if (!this.rateLimit.hit(`captcha:${ip}`, CAPTCHA_LIMIT, CAPTCHA_WINDOW_MS)) {
      throw new HttpException(K.tooManyRequests, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.captcha.issue();
  }

  async register(dto: RegisterDto, ip: string): Promise<AuthResponse> {
    if (
      !this.rateLimit.hit(`register:${ip}`, REGISTER_LIMIT, REGISTER_WINDOW_MS)
    ) {
      throw new HttpException(K.tooManyRegisters, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Xác minh TRƯỚC khi chạm cơ sở dữ liệu.
    if (!this.captcha.verify(dto.captchaId, dto.captchaAnswer)) {
      throw new BadRequestException(K.captchaInvalid);
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException(K.emailTaken);
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const code = await generateUniqueCustomerCode(async (candidate) => {
      const taken = await this.prisma.user.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      return taken !== null;
    });
    const user = await this.prisma.user.create({
      data: { email, passwordHash, code },
    });
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto, ip: string): Promise<AuthResponse> {
    const email = dto.email.trim().toLowerCase();
    // Chặn dò mật khẩu theo cả IP lẫn email — một IP đổi email hoặc nhiều IP
    // cùng đánh một email đều bị giới hạn.
    const ipKey = `login:ip:${ip}`;
    const emailKey = `login:email:${email}`;
    if (
      !this.rateLimit.hit(ipKey, LOGIN_LIMIT, LOGIN_WINDOW_MS) ||
      !this.rateLimit.hit(emailKey, LOGIN_LIMIT, LOGIN_WINDOW_MS)
    ) {
      throw new HttpException(K.tooManyLogins, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(K.invalidCredentials);
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException(K.invalidCredentials);
    }
    if (user.lockedAt) {
      throw new ForbiddenException(K.accountLocked);
    }
    // Đăng nhập đúng → xóa số lần đếm để người dùng thật không bị vạ lây.
    this.rateLimit.reset(ipKey);
    this.rateLimit.reset(emailKey);
    return this.buildAuthResponse(user);
  }

  /**
   * Đổi mật khẩu (mọi vai trò) — yêu cầu xác nhận mật khẩu hiện tại.
   * Mọi token cũ mất hiệu lực ngay; trả về token mới để phiên đang dùng
   * không bị đăng xuất oan.
   */
  async changePassword(
    user: User,
    dto: ChangePasswordDto,
  ): Promise<{ success: boolean; accessToken: string }> {
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException(K.currentPasswordWrong);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    const { accessToken } = await this.buildAuthResponse(updated);
    return { success: true, accessToken };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user: toPublicUser(user) };
  }
}
