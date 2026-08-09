import { Global, Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { RateLimitService } from './rate-limit.service';

/** Global để auth và các module khác đều dùng được. */
@Global()
@Module({
  providers: [CaptchaService, RateLimitService],
  exports: [CaptchaService, RateLimitService],
})
export class SecurityModule {}
