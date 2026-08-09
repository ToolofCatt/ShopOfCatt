import { Global, Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

/** Global để auth và các module khác đều dùng được. */
@Global()
@Module({
  providers: [CaptchaService, RateLimitService, RateLimitGuard],
  exports: [CaptchaService, RateLimitService, RateLimitGuard],
})
export class SecurityModule {}
