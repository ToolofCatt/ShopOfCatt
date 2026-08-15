import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PRODUCT_IMAGE_MAX_LENGTH } from '@webcatt/shared';
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

  /**
   * Ảnh sản phẩm dạng data URI (trình duyệt đã nén trước khi gửi).
   *
   * Cột trong CSDL là TEXT không giới hạn, nên KHÔNG có mức chặn này thì một ảnh
   * vài chục MB sẽ vào thẳng cơ sở dữ liệu — và nằm trong cả 14 bản sao lưu.
   */
  @IsOptional()
  @IsString({ message: K.adminImageInvalid })
  @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge })
  image?: string;

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
