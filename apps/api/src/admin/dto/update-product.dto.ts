import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PRODUCT_IMAGE_MAX_LENGTH,
  PRODUCT_THUMBNAIL_MAX_LENGTH,
  STOCK_DRAW_MODES,
  type StockDrawMode,
} from '@webcatt/shared';
import { K } from '../../i18n/messages';

/** Giá không còn nằm ở sản phẩm — sửa giá qua `PATCH /admin/variants/:id`. */
/**
 * Ô để trống được gửi lên là `null` (không phải chuỗi rỗng) — đó là cách biểu
 * mẫu xoá một giá trị đã đặt. `@IsOptional()` bỏ qua cả null lẫn undefined nên
 * null đi lọt xuống service; khai báo `string | null` để chỗ nào quên xử lý null
 * thì trình biên dịch chặn ngay, thay vì đổ 500 lúc chạy.
 */
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
  shortDescription?: string | null;

  @IsOptional()
  @IsString({ message: K.adminDescriptionInvalid })
  description?: string | null;

  /**
   * Ảnh sản phẩm dạng data URI (trình duyệt đã nén trước khi gửi).
   *
   * Cột trong CSDL là TEXT không giới hạn, nên KHÔNG có mức chặn này thì một ảnh
   * vài chục MB sẽ vào thẳng cơ sở dữ liệu — và nằm trong cả 14 bản sao lưu.
   */
  @IsOptional()
  @IsString({ message: K.adminImageInvalid })
  @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge })
  image?: string | null;

  /**
   * Bản thu nhỏ của ảnh bìa (~400px), do trình duyệt sinh cùng lúc với ảnh lớn.
   * Truy vấn danh sách chỉ kéo cột này về, nên nó phải nhỏ thật.
   */
  @IsOptional()
  @IsString({ message: K.adminThumbnailInvalid })
  @MaxLength(PRODUCT_THUMBNAIL_MAX_LENGTH, { message: K.adminThumbnailTooLarge })
  thumbnail?: string | null;

  @IsOptional()
  @IsString({ message: K.adminCategoryInvalid })
  category?: string | null;

  @IsOptional()
  @IsInt({ message: K.adminSortOrderInt })
  sortOrder?: number;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;

  /**
   * Cách rút kho. Danh sách hợp lệ lấy thẳng từ STOCK_DRAW_MODES trong shared,
   * nên thêm kiểu rút mới ở đó là chỗ này tự nhận.
   */
  @IsOptional()
  @IsIn(STOCK_DRAW_MODES, { message: K.adminStockDrawModeInvalid })
  stockDrawMode?: StockDrawMode;
}
