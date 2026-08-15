import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { K } from '../../i18n/messages';

/** Khoảng thời gian gộp cho bảng thống kê hành vi khách. */
export const INSIGHT_DAYS = [7, 30, 90] as const;
export type InsightDays = (typeof INSIGHT_DAYS)[number];

export class InsightsQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsIn(INSIGHT_DAYS, { message: K.seriesDaysInvalid })
  days?: InsightDays;
}
