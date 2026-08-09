import { PASSWORD_MIN_LENGTH } from '@webcatt/shared';
import { IsString, MinLength } from 'class-validator';
import { Match } from '../../common/match.decorator';
import { K, withParams } from '../../i18n/messages';

export class ChangePasswordDto {
  @IsString({ message: K.passwordInvalid })
  @MinLength(1, { message: K.passwordRequired })
  currentPassword: string;

  @IsString({ message: K.passwordInvalid })
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: withParams(K.passwordMin, { min: PASSWORD_MIN_LENGTH }),
  })
  newPassword: string;

  @IsString({ message: K.confirmRequired })
  @Match('newPassword', { message: K.confirmMismatch })
  confirmPassword: string;
}
