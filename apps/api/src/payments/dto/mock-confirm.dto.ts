import { IsNotEmpty, IsString } from 'class-validator';
import { K } from '../../i18n/messages';

export class MockConfirmDto {
  @IsString({ message: K.paymentCodeInvalid })
  @IsNotEmpty({ message: K.paymentCodeRequired })
  code: string;
}
