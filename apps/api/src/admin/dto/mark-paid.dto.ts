import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { K } from '../../i18n/messages';

/**
 * Chọn transfer đã quan sát để xử lý đối soát. Field optional giữ tương thích
 * validation của client cũ, nhưng service từ chối thiếu id bằng thông báo REVIEW;
 * ghi chú không thể thay thế quyền sở hữu khoản tiền trong sổ canonical.
 */
export class MarkPaidDto {
  @IsOptional()
  @IsString({ message: K.adminMarkPaidNoteInvalid })
  @MaxLength(300, { message: K.adminMarkPaidNoteInvalid })
  note?: string;

  @IsOptional()
  @IsString({ message: K.paymentReviewRequired })
  @IsNotEmpty({ message: K.paymentReviewRequired })
  @MaxLength(200, { message: K.paymentReviewRequired })
  incomingTransferId?: string;
}
