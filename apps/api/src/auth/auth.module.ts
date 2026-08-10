import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/** Khóa ngắn hơn mức này coi như không đủ an toàn để ký phiên đăng nhập. */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Giá trị mẫu từng nằm trong .env.docker.example và README. Chúng dài hơn 32 ký
 * tự nên lọt qua kiểm tra độ dài, mà lại công khai trong mã nguồn — ai cũng ký
 * được token quản trị giả. Đây là cách chặn duy nhất: chặn theo tên.
 */
const PLACEHOLDER_SECRETS = new Set([
  'doi-thanh-chuoi-ngau-nhien-that-dai-truoc-khi-chay',
  'doi-thanh-chuoi-bi-mat-ngau-nhien-that-dai-truoc-khi-chay',
  'webcatt-dev-secret',
  'change-me',
  'changeme',
]);

/**
 * Không có khóa dự phòng. Trước đây thiếu JWT_SECRET thì ứng dụng vẫn khởi động
 * bình thường với một hằng số nằm ngay trong mã nguồn — ai đọc được repo cũng
 * ký được token giả. Giờ thiếu, quá ngắn, hoặc còn để nguyên giá trị mẫu là
 * DỪNG NGAY lúc khởi động.
 */
function requireJwtSecret(config: ConfigService): string {
  const secret = (config.get<string>('JWT_SECRET') ?? '').trim();
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET chưa được đặt hoặc ngắn hơn ${MIN_JWT_SECRET_LENGTH} ký tự. ` +
        'Sinh khóa mới bằng: openssl rand -base64 48',
    );
  }
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      'JWT_SECRET vẫn đang là giá trị mẫu công khai trong mã nguồn — bất kỳ ai ' +
        'cũng ký được token quản trị giả. Sinh khóa riêng: openssl rand -base64 48',
    );
  }
  return secret;
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        // Chốt thuật toán tại chỗ thay vì dựa vào mặc định của thư viện
        signOptions: { expiresIn: '7d', algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
