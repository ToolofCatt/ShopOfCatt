import { IsNotEmpty, IsString } from 'class-validator';
import { K } from '../../i18n/messages';

export class SubmitTxDto {
  @IsString({ message: K.paymentTxIdInvalid })
  @IsNotEmpty({ message: K.paymentTxIdRequired })
  txId: string;
}
