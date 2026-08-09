import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { K } from '../../i18n/messages';

export class AnnouncementTextDto {
  @IsOptional()
  @IsString({ message: K.adminAnnouncementTitleInvalid })
  title?: string;

  @IsOptional()
  @IsString({ message: K.adminAnnouncementBodyInvalid })
  body?: string;
}

/** Bản dịch do quản trị viên tự sửa (ghi đè kết quả dịch tự động). */
export class AnnouncementTranslationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementTextDto)
  en?: AnnouncementTextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AnnouncementTextDto)
  zh?: AnnouncementTextDto;
}

export class UpdateAnnouncementDto {
  @IsBoolean({ message: K.adminAnnouncementActiveInvalid })
  active: boolean;

  @IsString({ message: K.adminAnnouncementTitleInvalid })
  title: string;

  @IsString({ message: K.adminAnnouncementBodyInvalid })
  body: string;

  @IsOptional()
  @IsObject({ message: K.adminAnnouncementTranslationsInvalid })
  @ValidateNested()
  @Type(() => AnnouncementTranslationsDto)
  translations?: AnnouncementTranslationsDto;
}
