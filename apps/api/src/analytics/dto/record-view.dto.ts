import { IsString, MaxLength, MinLength } from 'class-validator';
import { K } from '../../i18n/messages';

export class RecordViewDto {
  /** cuid của sản phẩm. Giá trị lạ bị câu lệnh SQL bỏ qua, không ném lỗi. */
  @IsString({ message: K.analyticsPayloadInvalid })
  @MinLength(1, { message: K.analyticsPayloadInvalid })
  @MaxLength(64, { message: K.analyticsPayloadInvalid })
  productId: string;
}
