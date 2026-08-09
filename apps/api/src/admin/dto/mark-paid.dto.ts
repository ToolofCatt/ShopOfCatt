import { IsOptional, IsString, MaxLength } from 'class-validator';
import { K } from '../../i18n/messages';

/**
 * Xác nhận đã nhận tiền ngoài hệ thống (chuyển khoản ngân hàng, khách nạp USDT
 * mà bộ đối soát tự động không khớp được…). Ghi chú là bắt buộc về mặt vận hành
 * dù không bắt buộc kỹ thuật: sáu tháng sau không ai nhớ vì sao đơn này được
 * duyệt tay, nên nó được lưu vào nhật ký thao tác.
 */
export class MarkPaidDto {
  @IsOptional()
  @IsString({ message: K.adminMarkPaidNoteInvalid })
  @MaxLength(300, { message: K.adminMarkPaidNoteInvalid })
  note?: string;
}
