import { IsEmail, IsString, MinLength } from 'class-validator';
import { K } from '../../i18n/messages';

export class LoginDto {
  @IsEmail({}, { message: K.emailInvalid })
  email: string;

  @IsString({ message: K.passwordInvalid })
  @MinLength(1, { message: K.passwordRequired })
  password: string;
}
