import { IsString, MaxLength } from 'class-validator';
import { K } from '../../i18n/messages';

export class UpdateLegalPageDto {
  @IsString({ message: K.legalTitleInvalid })
  @MaxLength(200, { message: K.legalTitleInvalid })
  title: string;

  /** HTML từ trình soạn thảo — máy chủ lọc lại theo allowlist khi lưu. */
  @IsString({ message: K.legalBodyInvalid })
  @MaxLength(100_000, { message: K.legalBodyInvalid })
  body: string;
}
