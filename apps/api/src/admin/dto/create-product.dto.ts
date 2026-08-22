import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DISPLAY_CURRENCIES,
  PRODUCT_IMAGE_MAX_LENGTH,
  PRODUCT_THUMBNAIL_MAX_LENGTH,
  STOCK_DRAW_MODES,
  type DisplayCurrency,
  type StockDrawMode,
} from '@webcatt/shared';
import { K } from '../../i18n/messages';

export class CreateProductDto {
  @IsString({ message: K.adminNameInvalid })
  @IsNotEmpty({ message: K.adminNameRequired })
  name: string;

  /** Giá của loại mặc định ("Mặc định") được tạo cùng sản phẩm. */
  /**
   * Số tiền chủ shop GÕ VÀO, theo `priceCurrency`. Hai chữ số thập phân là đủ
   * cho mọi đơn vị chủ shop gõ; con số USDT sáu chữ số là do máy chủ suy ra,
   * không nhận từ client.
   */
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: K.adminPriceNumber },
  )
  @Min(0, { message: K.adminPriceMin })
  price: number;

  /** Đơn vị của `price`. Thiếu thì coi như USDT, giữ nguyên hành vi cũ. */
  @IsOptional()
  @IsIn(DISPLAY_CURRENCIES, { message: K.adminPriceCurrencyInvalid })
  priceCurrency?: DisplayCurrency;

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

  /**
   * Bản thu nhỏ của ảnh bìa (~400px), do trình duyệt sinh cùng lúc với ảnh lớn.
   * Truy vấn danh sách chỉ kéo cột này về, nên nó phải nhỏ thật.
   */
  @IsOptional()
  @IsString({ message: K.adminThumbnailInvalid })
  @MaxLength(PRODUCT_THUMBNAIL_MAX_LENGTH, { message: K.adminThumbnailTooLarge })
  thumbnail?: string;

  @IsOptional()
  @IsString({ message: K.adminCategoryInvalid })
  category?: string;

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
