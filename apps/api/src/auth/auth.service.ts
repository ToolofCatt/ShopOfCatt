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
import { isAdminRole, type AuthResponse, type CaptchaDto } from '@webcatt/shared';
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

/**
 * Hạn phiên đăng nhập, chia theo vai trò.
 *
 * Token nằm trong `localStorage` của trình duyệt, nên một lỗ XSS bất kỳ là kẻ
 * tấn công cầm được token cho tới khi nó hết hạn. Với khách, mất phiên nghĩa là
 * xem lại được đơn của mình; với admin, nó là toàn quyền cửa hàng — kho key, mã
 * giảm giá, đặt lại mật khẩu khách. Vì vậy admin dùng hạn ngắn hơn nhiều.
 *
 * Đổi hai giá trị này là đổi cả cửa sổ thiệt hại lẫn mức bất tiện; đừng nâng hạn
 * của admin lên chỉ vì phải đăng nhập lại.
 */
const TOKEN_TTL_USER = '7d';
const TOKEN_TTL_ADMIN = '12h';

/**
 * Hash mồi, dùng cho nhánh "email không tồn tại" khi đăng nhập. Sinh lúc nạp
 * module nên nó KHÔNG phải là mật khẩu của ai và không có ai đăng nhập được bằng
 * nó; mục đích duy nhất là để hai nhánh tốn thời gian bcrypt như nhau.
 */
const DECOY_PASSWORD_HASH = bcrypt.hashSync(
  'khong-phai-mat-khau-cua-ai-chi-de-can-bang-thoi-gian',
  BCRYPT_ROUNDS,
);

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
      // So sánh với một hash giả trước khi trả lỗi. Không có bước này, email
      // KHÔNG tồn tại trả về ngay còn email CÓ tồn tại phải chờ bcrypt (~100ms),
      // nên chỉ cần đo thời gian phản hồi là dò ra danh sách khách của cửa hàng.
      await bcrypt.compare(dto.password, DECOY_PASSWORD_HASH);
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
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: isAdminRole(user.role) ? TOKEN_TTL_ADMIN : TOKEN_TTL_USER,
    });
    return { accessToken, user: toPublicUser(user) };
  }
}
