import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PRODUCT_IMAGE_MAX_LENGTH,
  SUPPORT_CHANNELS_MAX,
  SUPPORT_FIELD_MAX_LENGTH,
  SUPPORT_NOTE_MAX_LENGTH,
} from '@webcatt/shared';
import { K } from '../../i18n/messages';

export class SupportChannelInput {
  @IsString({ message: K.adminSupportContactInvalid })
  @IsNotEmpty({ message: K.adminSupportContactInvalid })
  @MaxLength(SUPPORT_FIELD_MAX_LENGTH, { message: K.adminSupportContactInvalid })
  label: string;

  @IsString({ message: K.adminSupportContactInvalid })
  @IsNotEmpty({ message: K.adminSupportContactInvalid })
  @MaxLength(SUPPORT_FIELD_MAX_LENGTH, { message: K.adminSupportContactInvalid })
  value: string;

  @IsOptional()
  @IsString({ message: K.adminSupportUrlInvalid })
  @MaxLength(300, { message: K.adminSupportUrlInvalid })
  url?: string;
}

export class UpdateSettingsDto {
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  mockEnabled: boolean;

  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  binancePayEnabled: boolean;

  /** Nhận tiền bằng cách khách chuyển thẳng tới Binance ID của chủ shop. */
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  binanceIdEnabled: boolean;

  /**
   * Binance ID — chỉ gồm chữ số. Không ép độ dài cố định vì Binance có thể đổi,
   * nhưng chặn ký tự lạ để chủ shop không dán nhầm tên hiển thị vào đây rồi
   * khách chuyển tiền tới hư không.
   */
  @IsString({ message: K.adminBinanceIdInvalid })
  @Matches(/^[0-9]*$/, { message: K.adminBinanceIdInvalid })
  @MaxLength(32, { message: K.adminBinanceIdInvalid })
  binanceId: string;

  /**
   * Ảnh QR nhận tiền Binance Pay, data URI đã nén ở trình duyệt.
   *
   * Dùng mức chặn của ảnh LỚN chứ không phải ảnh nhỏ: mã QR cần nét, nén mạnh
   * là các ô vuông nhoè và máy quét đọc không ra. Chỉ một ảnh cho cả cửa hàng
   * nên vài trăm KB trong CSDL là chấp nhận được.
   */
  @IsOptional()
  @IsString({ message: K.adminImageInvalid })
  @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge })
  binanceQr?: string;

  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  cryptoEnabled: boolean;

  @IsString({ message: K.adminSettingsAddressInvalid })
  bep20Address: string;

  @IsString({ message: K.adminSettingsAddressInvalid })
  trc20Address: string;

  /** Các kênh liên hệ hỗ trợ hiện ở khối "Quên mật khẩu". */
  @IsOptional()
  @IsArray({ message: K.adminSupportContactInvalid })
  @ArrayMaxSize(SUPPORT_CHANNELS_MAX, { message: K.adminSupportTooMany })
  @ValidateNested({ each: true })
  @Type(() => SupportChannelInput)
  supportChannels?: SupportChannelInput[];

  /** Lời nhắn tùy chỉnh ở khối "Quên mật khẩu". */
  @IsOptional()
  @IsString({ message: K.adminSupportNoteInvalid })
  @MaxLength(SUPPORT_NOTE_MAX_LENGTH, { message: K.adminSupportNoteInvalid })
  supportNote?: string;
}
