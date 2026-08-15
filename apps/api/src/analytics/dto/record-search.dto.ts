import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { K } from '../../i18n/messages';

export class RecordSearchDto {
  /**
   * Từ khoá thô. Chặn ở 200 ký tự tại đây (service còn cắt tiếp xuống 60): ô
   * tìm kiếm là chỗ ai cũng dán được cả một đoạn văn vào.
   */
  @IsString({ message: K.analyticsPayloadInvalid })
  @MaxLength(200, { message: K.analyticsPayloadInvalid })
  term: string;

  /** Số kết quả khách nhìn thấy. Bằng 0 nghĩa là cửa hàng không có thứ họ tìm. */
  @IsInt({ message: K.analyticsPayloadInvalid })
  @Min(0, { message: K.analyticsPayloadInvalid })
  resultCount: number;
}
