import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { I18nExceptionFilter } from './i18n/i18n-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.get<string>('WEB_URL') ?? 'http://localhost:3000' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Dịch thông báo lỗi sang ngôn ngữ người dùng (header Accept-Language)
  app.useGlobalFilters(new I18nExceptionFilter());

  const port = parseInt(config.get<string>('PORT') ?? '3001', 10) || 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API đang chạy tại http://localhost:${port}/api`);
}

void bootstrap();
