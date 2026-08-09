import { AUDIT_ACTIONS, type AuditAction } from '@webcatt/shared';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { toPositiveInt } from '../../common/codes';
import { K } from '../../i18n/messages';

export class AuditQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(AUDIT_ACTIONS, { message: K.auditActionInvalid })
  action?: AuditAction;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminPageInvalid })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminLimitInvalid })
  limit?: number;
}
