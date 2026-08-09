import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from '../../orders/dto/create-order.dto';
import { K } from '../../i18n/messages';

/** Xem trước số tiền giảm — giá lấy từ CSDL, không tin số client gửi lên. */
export class PreviewCouponDto {
  @IsString({ message: K.couponCodeInvalid })
  @IsNotEmpty({ message: K.couponCodeRequired })
  code: string;

  @IsArray({ message: K.orderItemsInvalid })
  @ArrayMinSize(1, { message: K.orderItemsMin })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
