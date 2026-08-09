import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { K } from '../../i18n/messages';

/** Giá không còn nằm ở sản phẩm — sửa giá qua `PATCH /admin/variants/:id`. */
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: K.adminNameInvalid })
  @IsNotEmpty({ message: K.adminNameRequired })
  name?: string;

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
