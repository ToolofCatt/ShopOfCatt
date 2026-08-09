import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
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
