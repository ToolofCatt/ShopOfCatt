import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';

/**
 * Endpoint kiểm tra sức khỏe — dùng cho Docker healthcheck / load balancer.
 * Trả 503 khi không kết nối được cơ sở dữ liệu để container được đánh dấu unhealthy.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: string; database: string; uptime: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
        message: K.databaseDown,
      });
    }
    return {
      status: 'ok',
      database: 'up',
      uptime: Math.floor(process.uptime()),
    };
  }
}
