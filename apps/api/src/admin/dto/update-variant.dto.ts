import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@webcatt/shared';
import { K } from '../../i18n/messages';

export class UpdateVariantDto {
  @IsOptional()
  @IsString({ message: K.adminVariantNameInvalid })
  @IsNotEmpty({ message: K.adminVariantNameRequired })
  name?: string;

  /**
   * Số tiền chủ shop GÕ VÀO, theo `priceCurrency`. Hai chữ số thập phân là đủ
   * cho mọi đơn vị chủ shop gõ; con số USDT sáu chữ số là do máy chủ suy ra,
   * không nhận từ client.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: K.adminPriceNumber })
  @Min(0, { message: K.adminPriceMin })
  price?: number;

  /** Đơn vị của `price`. Thiếu thì coi như USDT, giữ nguyên hành vi cũ. */
  @IsOptional()
  @IsIn(DISPLAY_CURRENCIES, { message: K.adminPriceCurrencyInvalid })
  priceCurrency?: DisplayCurrency;

  @IsOptional()
  @IsInt({ message: K.adminSortOrderInt })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;
}
