import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { COUPON_CODE_MAX_LENGTH } from '@webcatt/shared';
import { K } from '../../i18n/messages';

/** Chuỗi rỗng từ form → undefined, để các trường "không giới hạn" là null. */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' || value === null ? undefined : value;

export class CreateCouponDto {
  @IsString({ message: K.couponCodeInvalid })
  @IsNotEmpty({ message: K.couponCodeRequired })
  @MaxLength(COUPON_CODE_MAX_LENGTH, { message: K.couponCodeInvalid })
  code: string;

  @IsIn(['PERCENT', 'FIXED'], { message: K.couponTypeInvalid })
  type: 'PERCENT' | 'FIXED';

  @IsNumber({}, { message: K.couponValueInvalid })
  @Min(0.01, { message: K.couponValueInvalid })
  value: number;

  @IsOptional()
  @IsNumber({}, { message: K.couponNumberInvalid })
  @Min(0, { message: K.couponNumberInvalid })
  minAmount?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsInt({ message: K.couponNumberInvalid })
  @Min(1, { message: K.couponNumberInvalid })
  maxUses?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsInt({ message: K.couponNumberInvalid })
  @Min(1, { message: K.couponNumberInvalid })
  perUserLimit?: number;

  /** ISO date — để trống là áp dụng ngay / không hết hạn. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: K.couponDateInvalid })
  startsAt?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: K.couponDateInvalid })
  expiresAt?: string;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: K.couponNoteInvalid })
  @MaxLength(200, { message: K.couponNoteInvalid })
  note?: string;
}

/**
 * Sửa mã: `code` không đổi được. Quy ước cho các trường "không giới hạn":
 * bỏ trống (undefined) = giữ nguyên, `null` = xóa giới hạn.
 * `@IsOptional()` của class-validator bỏ qua cả null lẫn undefined nên null
 * đi lọt xuống service và được phân biệt ở đó.
 */
export class UpdateCouponDto {
  @IsOptional()
  @IsIn(['PERCENT', 'FIXED'], { message: K.couponTypeInvalid })
  type?: 'PERCENT' | 'FIXED';

  @IsOptional()
  @IsNumber({}, { message: K.couponValueInvalid })
  @Min(0.01, { message: K.couponValueInvalid })
  value?: number;

  @IsOptional()
  @IsNumber({}, { message: K.couponNumberInvalid })
  @Min(0, { message: K.couponNumberInvalid })
  minAmount?: number;

  @IsOptional()
  @IsInt({ message: K.couponNumberInvalid })
  @Min(1, { message: K.couponNumberInvalid })
  maxUses?: number | null;

  @IsOptional()
  @IsInt({ message: K.couponNumberInvalid })
  @Min(1, { message: K.couponNumberInvalid })
  perUserLimit?: number | null;

  @IsOptional()
  @IsString({ message: K.couponDateInvalid })
  startsAt?: string | null;

  @IsOptional()
  @IsString({ message: K.couponDateInvalid })
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean({ message: K.adminActiveInvalid })
  active?: boolean;

  @IsOptional()
  @IsString({ message: K.couponNoteInvalid })
  @MaxLength(200, { message: K.couponNoteInvalid })
  note?: string | null;
}
