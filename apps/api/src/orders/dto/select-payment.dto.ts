import type { PaymentMethod } from '@webcatt/shared';
import { IsIn, IsString } from 'class-validator';
import { K } from '../../i18n/messages';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'mock',
  'binance_pay',
  'crypto_bep20',
  'crypto_trc20',
] as const;

export class SelectPaymentDto {
  @IsString({ message: K.paymentMethodInvalid })
  @IsIn(PAYMENT_METHODS as PaymentMethod[], { message: K.paymentMethodInvalid })
  method: PaymentMethod;
}
