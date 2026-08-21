import type { PaymentMethod } from '@webcatt/shared';
import { IsIn, IsString } from 'class-validator';
import { K } from '../../i18n/messages';

/**
 * Danh sách này phải khớp kiểu `PaymentMethod` trong @webcatt/shared. Thêm
 * phương thức mới mà quên cập nhật ở đây thì API luôn trả 400 "phương thức
 * không hợp lệ" dù cửa hàng đã bật — khách không đổi được phương thức.
 * `satisfies` bắt TypeScript kêu ngay nếu thiếu một giá trị.
 */
export const PAYMENT_METHODS = [
  'mock',
  'binance_pay',
  'binance_id',
  'crypto_bep20',
  'crypto_trc20',
  'sepay',
] as const satisfies readonly PaymentMethod[];

/**
 * Rào chắn lúc BIÊN DỊCH: nếu `PaymentMethod` có thêm giá trị mà danh sách trên
 * chưa liệt kê, `Missing` khác `never` và dòng dưới không biên dịch được.
 * `satisfies` ở trên chỉ bảo đảm không thừa; dòng này bảo đảm không thiếu.
 */
type MissingPaymentMethod = Exclude<
  PaymentMethod,
  (typeof PAYMENT_METHODS)[number]
>;
const _allMethodsListed: MissingPaymentMethod extends never ? true : never =
  true;
void _allMethodsListed;

export class SelectPaymentDto {
  @IsString({ message: K.paymentMethodInvalid })
  @IsIn(PAYMENT_METHODS as unknown as PaymentMethod[], {
    message: K.paymentMethodInvalid,
  })
  method: PaymentMethod;
}
