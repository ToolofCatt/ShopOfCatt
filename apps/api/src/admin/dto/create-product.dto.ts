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

export class CreateProductDto {
  @IsString({ message: K.adminNameInvalid })
  @IsNotEmpty({ message: K.adminNameRequired })
  name: string;

  /** Giá của loại mặc định ("Mặc định") được tạo cùng sản phẩm. */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: K.adminPriceNumber },
  )
  @Min(0, { message: K.adminPriceMin })
  price: number;

  @IsOptional()
  @IsString({ message: K.adminSlugInvalid })
  slug?: string;

  @IsOptional()
  @IsString({ message: K.adminShortDescriptionInvalid })
  shortDescription?: string;

  @IsOptional()
  @IsString({ message: K.adminDescriptionInvalid })
  description?: string;

  @IsOptional()
  @IsString({ message: K.adminImageInvalid })
  image?: string;

  @IsOptional()
  @IsString({ message: K.adminIconInvalid })
  icon?: string;

  @IsOptional()
  @IsString({ message: K.adminCategoryInvalid })
  category?: string;

  @IsOptional()
  @IsInt({ message: K.adminSortOrderInt })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;
}
