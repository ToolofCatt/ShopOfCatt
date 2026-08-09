import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentService } from './fulfillment.service';

/** Chu kỳ quét. */
const TICK_MS = 2 * 60_000;

/**
 * Bỏ qua đơn vừa mới thanh toán vài giây — luồng giao hàng chính có thể đang
 * chạy dở, quét vào lúc đó chỉ tạo tranh chấp khoá vô ích.
 */
const MIN_AGE_MS = 60_000;

/** Không ôm quá nhiều đơn trong một lượt, tránh giữ khoá lâu. */
const BATCH = 20;

/**
 * Cứu các đơn KẸT — tiền đã vào nhưng hàng chưa ra.
 *
 * Hai tình huống thực tế trước đây không có gì tự sửa:
 *
 * 1. Đơn `PAID` nhưng chưa `DELIVERED`: lúc thanh toán kho thiếu, hoặc tiến
 *    trình chết giữa bước "đánh dấu đã trả" và bước "giao hàng". Chốt trạng thái
 *    của `markPaidAndDeliver` khiến mọi lần gọi lại đều thoát sớm, nên đơn nằm
 *    im cho tới khi có người phát hiện bằng mắt.
 *
 * 2. Payment `SUCCESS` nhưng đơn vẫn `PENDING`: tiến trình chết ngay sau khi ghi
 *    nhận khoản nạp. Bộ đối soát crypto chỉ quét đơn `PENDING` có payment
 *    `PENDING` nên bỏ sót vĩnh viễn, rồi đơn hết hạn và kho bị bán lại cho người
 *    khác — khách đã trả tiền mà mất hàng.
 *
 * Quét định kỳ là cách rẻ nhất để hai tình huống đó tự lành thay vì thành khiếu nại.
 */
@Injectable()
export class DeliverySweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliverySweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    this.logger.log(`Quét đơn kẹt: bật (mỗi ${TICK_MS / 1000} giây)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Một lượt quét. Không bao giờ ném lỗi ra ngoài. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.deliverPaidOrders();
      await this.promotePaidPayments();
    } catch (error) {
      this.logger.error(
        `Quét đơn kẹt lỗi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.running = false;
    }
  }

  /** (1) Đơn PAID nhưng chưa giao đủ hàng → thử giao lại. */
  private async deliverPaidOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - MIN_AGE_MS);
    const stuck = await this.prisma.order.findMany({
      where: { status: 'PAID', paidAt: { lt: cutoff } },
      select: { id: true, code: true },
      orderBy: { paidAt: 'asc' },
      take: BATCH,
    });

    for (const order of stuck) {
      try {
        const delivered = await this.fulfillment.deliverOrder(order.id);
        if (delivered) {
          this.logger.log(`Đã giao bù đơn kẹt ${order.code}`);
        } else {
          // Còn thiếu kho — không phải lỗi, nhưng chủ shop cần biết để nhập thêm.
          this.logger.warn(
            `Đơn ${order.code} đã thanh toán nhưng kho chưa đủ để giao`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Không giao bù được đơn ${order.code}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** (2) Payment đã SUCCESS mà đơn còn PENDING/EXPIRED → đưa về PAID rồi giao. */
  private async promotePaidPayments(): Promise<void> {
    const cutoff = new Date(Date.now() - MIN_AGE_MS);
    const orphans = await this.prisma.payment.findMany({
      where: {
        status: 'SUCCESS',
        updatedAt: { lt: cutoff },
        order: { status: { in: ['PENDING', 'EXPIRED'] } },
      },
      select: { orderId: true, order: { select: { code: true } } },
      take: BATCH,
    });

    for (const payment of orphans) {
      try {
        const result = await this.fulfillment.markPaidAndDeliver({
          orderId: payment.orderId,
        });
        this.logger.log(
          `Đơn ${payment.order.code} có payment SUCCESS nhưng chưa chuyển trạng thái — đã xử lý (${result?.status ?? 'không rõ'})`,
        );
      } catch (error) {
        this.logger.error(
          `Không xử lý được đơn ${payment.order.code}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
