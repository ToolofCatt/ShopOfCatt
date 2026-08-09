import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { K } from '../../i18n/messages';

export class CreateOrderItemDto {
  @IsString({ message: K.orderVariantIdInvalid })
  @IsNotEmpty({ message: K.orderVariantIdRequired })
  variantId: string;

  @IsInt({ message: K.orderQuantityInt })
  @Min(1, { message: K.orderQuantityMin })
  quantity: number;
}

export class CreateOrderDto {
  @IsArray({ message: K.orderItemsInvalid })
  @ArrayMinSize(1, { message: K.orderItemsMin })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  /** Mã giảm giá (tùy chọn). */
  @IsOptional()
  @IsString({ message: K.couponCodeInvalid })
  couponCode?: string;
}
