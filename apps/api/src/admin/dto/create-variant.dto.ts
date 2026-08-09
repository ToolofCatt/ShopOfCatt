import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { K } from '../../i18n/messages';

export class CreateVariantDto {
  @IsString({ message: K.adminVariantNameInvalid })
  @IsNotEmpty({ message: K.adminVariantNameRequired })
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: K.adminPriceNumber })
  @Min(0, { message: K.adminPriceMin })
  price: number;

  @IsOptional()
  @IsInt({ message: K.adminSortOrderInt })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;
}
