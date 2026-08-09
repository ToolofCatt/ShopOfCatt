import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { I18nExceptionFilter } from './i18n/i18n-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const config = app.get(ConfigService);

  /*
   * Sau reverse proxy (nginx/Caddy) Express mặc định coi MỌI request đến từ IP
   * của proxy. Bộ đếm tần suất khi đó dùng chung một "xô" cho toàn bộ khách:
   * một kẻ tấn công gõ sai mật khẩu 10 lần là khoá đăng nhập của cả cửa hàng.
   * `trust proxy = 1` cho phép đọc X-Forwarded-For do proxy (một chặng) ghi.
   */
  app.set('trust proxy', 1);

  /*
   * Header bảo mật. Trang quản trị không được phép nhúng trong iframe của người
   * khác (chống clickjacking), và không rò referrer sang site ngoài.
   * CSP tắt ở đây vì API chỉ trả JSON; phần CSP cho trang web nằm ở
   * apps/web/next.config.ts nơi biết rõ nguồn script/style hợp lệ.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get<string>('WEB_URL') ?? 'http://localhost:3000' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Dịch thông báo lỗi sang ngôn ngữ người dùng (header Accept-Language)
  app.useGlobalFilters(new I18nExceptionFilter());

  // Đóng kết nối Prisma gọn gàng khi nhận SIGTERM lúc redeploy.
  app.enableShutdownHooks();

  const port = parseInt(config.get<string>('PORT') ?? '3001', 10) || 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API đang chạy tại http://localhost:${port}/api`);
}

void bootstrap();
