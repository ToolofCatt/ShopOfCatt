import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PRODUCT_IMAGE_MAX_COUNT, PRODUCT_IMAGE_MAX_LENGTH } from '@webcatt/shared';
import { K } from '../../i18n/messages';

/**
 * Thêm MỘT ảnh phụ mỗi lần gọi.
 *
 * Cố ý không nhận cả mảng ảnh trong một request: giới hạn thân request là 2 MB
 * (`main.ts`), mà sáu ảnh ~375 KB là đã 2,25 MB — gửi gộp thì lỗi 413 xuất hiện
 * đúng lúc chủ shop vừa chọn xong ảnh, không có cách nào cứu. Mỗi ảnh một
 * request thì mỗi request luôn nằm gọn dưới hạn.
 */
export class AddProductImageDto {
  @IsString({ message: K.adminImageInvalid })
  @IsNotEmpty({ message: K.adminImageDataRequired })
  @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge })
  data: string;
}

/** Sắp xếp lại ảnh phụ: gửi lên toàn bộ id theo đúng thứ tự mong muốn. */
export class ReorderProductImagesDto {
  @IsArray({ message: K.adminImageOrderMismatch })
  @ArrayNotEmpty({ message: K.adminImageOrderMismatch })
  @ArrayMaxSize(PRODUCT_IMAGE_MAX_COUNT, { message: K.adminImageOrderMismatch })
  @IsString({ each: true, message: K.adminImageOrderMismatch })
  ids: string[];
}
