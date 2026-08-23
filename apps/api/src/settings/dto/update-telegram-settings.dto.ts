import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { TELEGRAM_GREETING_MAX_LENGTH } from '@webcatt/shared';
import { K } from '../../i18n/messages';

/**
 * Cập nhật RIÊNG phần cấu hình bot Telegram — trang /admin/telegram gửi DTO
 * này thay vì UpdateSettingsDto đầy đủ. Tách ra vì DTO đầy đủ bắt buộc phải
 * gửi lại cả cấu hình thanh toán: trang bot mà phải echo số tài khoản ngân
 * hàng chỉ để đổi lời chào thì hai tab admin mở song song sẽ ghi đè nhau.
 */
export class UpdateTelegramSettingsDto {
  @IsOptional()
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  telegramBotEnabled?: boolean;

  /** Ba trạng thái như khoá AI: không gửi = giữ nguyên, rỗng = xoá, chuỗi = đặt mới. */
  @IsOptional()
  @IsString({ message: K.adminTelegramTokenInvalid })
  @MaxLength(64, { message: K.adminTelegramTokenInvalid })
  @Matches(/^$|^[0-9]{5,12}:[A-Za-z0-9_-]{30,50}$/, {
    message: K.adminTelegramTokenInvalid,
  })
  telegramBotToken?: string;

  @IsOptional()
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  telegramSendAnnouncement?: boolean;

  @IsOptional()
  @IsString({ message: K.adminTelegramGreetingTooLong })
  @MaxLength(TELEGRAM_GREETING_MAX_LENGTH, {
    message: K.adminTelegramGreetingTooLong,
  })
  telegramGreeting?: string;
}
