import { PASSWORD_MIN_LENGTH } from '@webcatt/shared';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { Match } from '../../common/match.decorator';
import { K, withParams } from '../../i18n/messages';

export class RegisterDto {
  @IsEmail({}, { message: K.emailInvalid })
  email: string;

  @IsString({ message: K.passwordInvalid })
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: withParams(K.passwordMin, { min: PASSWORD_MIN_LENGTH }),
  })
  password: string;

  @IsString({ message: K.confirmRequired })
  @Match('password', { message: K.confirmMismatch })
  confirmPassword: string;

  /** Mã câu hỏi xác minh lấy từ GET /auth/captcha. */
  @IsString({ message: K.captchaRequired })
  @IsNotEmpty({ message: K.captchaRequired })
  captchaId: string;

  @IsString({ message: K.captchaRequired })
  @IsNotEmpty({ message: K.captchaRequired })
  captchaAnswer: string;
}
