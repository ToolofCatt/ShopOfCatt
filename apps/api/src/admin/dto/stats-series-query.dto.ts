import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { K } from '../../i18n/messages';

/**
 * Biểu đồ doanh thu: 7 hoặc 30 ngày gần nhất. 14 và 60 để web lấy gấp đôi
 * khoảng thời gian trong MỘT lần gọi rồi tự so sánh với kỳ liền trước.
 */
export const SERIES_DAYS = [7, 14, 30, 60] as const;
export type SeriesDays = (typeof SERIES_DAYS)[number];

export class StatsSeriesQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined ? undefined : Number(value),
  )
  @IsIn(SERIES_DAYS, { message: K.seriesDaysInvalid })
  days?: SeriesDays;
}
