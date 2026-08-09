import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { toPositiveInt } from '../../common/codes';
import { K } from '../../i18n/messages';

export class CustomersQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString({ message: K.adminSearchInvalid })
  q?: string;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminPageInvalid })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminLimitInvalid })
  limit?: number;
}
