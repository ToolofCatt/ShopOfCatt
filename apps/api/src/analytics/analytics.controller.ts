import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { RateLimit, RateLimitGuard } from '../security/rate-limit.guard';
import { AnalyticsService } from './analytics.service';
import { RecordSearchDto } from './dto/record-search.dto';
import { RecordViewDto } from './dto/record-view.dto';

/**
 * Hai endpoint CÔNG KHAI để trang khách gửi tín hiệu về.
 *
 * Không yêu cầu đăng nhập — phần lớn người xem hàng chưa có tài khoản, mà đó
 * chính là nhóm cần đo. Đổi lại phải có giới hạn tần suất: đây là đường duy nhất
 * cho phép người lạ ghi vào cơ sở dữ liệu, và không chặn thì một script có thể
 * vừa thổi phồng số liệu vừa làm phình bảng.
 *
 * Luôn trả 204 kể cả khi dữ liệu vô nghĩa: trình duyệt không cần biết kết quả,
 * và trả lỗi chi tiết chỉ giúp người dò tìm cách gửi rác hiệu quả hơn.
 */
@Controller('analytics')
@UseGuards(RateLimitGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('product-view')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Một người xem 60 trang sản phẩm trong 10 phút đã là rất nhiều.
  @RateLimit({ limit: 60, windowMs: 10 * 60_000 })
  async recordView(@Body() dto: RecordViewDto): Promise<void> {
    await this.analytics.recordProductView(dto.productId);
  }

  @Post('search')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 60, windowMs: 10 * 60_000 })
  async recordSearch(@Body() dto: RecordSearchDto): Promise<void> {
    await this.analytics.recordSearch(dto.term, dto.resultCount);
  }
}
