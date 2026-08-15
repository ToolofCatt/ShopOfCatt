import { Injectable, Logger } from '@nestjs/common';
import type {
  ProductInsightDto,
  SearchInsightDto,
  StoreInsightsDto,
} from '@webcatt/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thống kê hành vi khách: xem gì, tìm gì.
 *
 * Hai nguyên tắc của cả file này:
 *
 * 1. KHÔNG BAO GIỜ chạm vào đường tiền. Mọi ghi nhận ở đây nằm ngoài transaction
 *    đơn hàng và tự nuốt lỗi — một lần ghi thống kê hỏng tuyệt đối không được
 *    làm hỏng một lần bán hàng.
 * 2. Cộng dồn bằng `INSERT ... ON CONFLICT DO UPDATE` chứ không phải đọc-rồi-ghi:
 *    hai khách xem cùng một sản phẩm trong cùng một khoảnh khắc thì cả hai lượt
 *    đều phải được tính.
 */

/** Cắt từ khoá quá dài — khách dán cả đoạn văn vào ô tìm kiếm là chuyện thường. */
const TERM_MAX_LENGTH = 60;
/** Dưới ngưỡng này coi như khách mới gõ dở, chưa phải một lần tìm thật. */
const TERM_MIN_LENGTH = 2;

/** Số dòng tối đa trả về mỗi bảng — trang tổng quan chỉ hiển thị được ngần này. */
const INSIGHT_LIMIT = 10;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chuẩn hoá từ khoá trước khi lưu: gộp khoảng trắng, chữ thường, cắt độ dài.
   * Không chuẩn hoá thì "Windows 11" và "windows  11" thành hai dòng khác nhau
   * và bảng thống kê vỡ vụn thành hàng trăm biến thể của cùng một ý.
   */
  static normalizeTerm(raw: string): string | null {
    const term = raw.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, TERM_MAX_LENGTH);
    return term.length >= TERM_MIN_LENGTH ? term : null;
  }

  /**
   * Ghi một lượt xem sản phẩm.
   *
   * `SELECT ... WHERE id = $1 AND active` thay vì `VALUES ($1)`: id không tồn tại
   * thì câu lệnh không chèn dòng nào và cũng không ném lỗi khoá ngoại. Endpoint
   * này công khai nên phải chịu được mọi giá trị rác gửi lên.
   */
  async recordProductView(productId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "ProductViewDaily" ("productId", "day", "views")
        SELECT p."id", CURRENT_DATE, 1
        FROM "Product" p
        WHERE p."id" = ${productId} AND p."active" = true
        ON CONFLICT ("productId", "day")
        DO UPDATE SET "views" = "ProductViewDaily"."views" + 1
      `;
    } catch (error) {
      this.logger.warn(
        `Không ghi được lượt xem sản phẩm: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Ghi một lần tìm kiếm. `resultCount = 0` được đếm riêng vào `zeroResults`. */
  async recordSearch(rawTerm: string, resultCount: number): Promise<void> {
    const term = AnalyticsService.normalizeTerm(rawTerm);
    if (term === null) return;
    const zero = resultCount === 0 ? 1 : 0;
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "SearchQueryDaily" ("term", "day", "count", "zeroResults")
        VALUES (${term}, CURRENT_DATE, 1, ${zero})
        ON CONFLICT ("term", "day")
        DO UPDATE SET
          "count" = "SearchQueryDaily"."count" + 1,
          "zeroResults" = "SearchQueryDaily"."zeroResults" + ${zero}
      `;
    } catch (error) {
      this.logger.warn(
        `Không ghi được từ khoá tìm kiếm: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Số liệu cho trang tổng quan của admin, gộp trong `days` ngày gần nhất. */
  async getInsights(days: number): Promise<StoreInsightsDto> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [products, topSearches, zeroResultSearches] = await Promise.all([
      this.getProductInsights(since),
      this.getTopSearches(since),
      this.getZeroResultSearches(since),
    ]);

    return { days, products, topSearches, zeroResultSearches };
  }

  /**
   * Ghép lượt xem với số đã bán trong cùng khoảng thời gian.
   *
   * FULL JOIN chứ không phải INNER: sản phẩm có lượt xem mà chưa bán được món
   * nào chính là thứ đáng chú ý nhất, mà INNER JOIN lại loại đúng nó đi.
   */
  private async getProductInsights(since: Date): Promise<ProductInsightDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        productId: string;
        name: string;
        slug: string;
        views: bigint | number;
        sold: bigint | number;
      }>
    >`
      WITH v AS (
        SELECT "productId", SUM("views")::bigint AS views
        FROM "ProductViewDaily"
        WHERE "day" >= ${since}::date
        GROUP BY "productId"
      ),
      s AS (
        SELECT oi."productId", SUM(oi."quantity")::bigint AS sold
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."status" IN ('PAID'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          AND o."paidAt" >= ${since}
        GROUP BY oi."productId"
      )
      SELECT p."id" AS "productId",
             p."name" AS name,
             p."slug" AS slug,
             COALESCE(v.views, 0) AS views,
             COALESCE(s.sold, 0) AS sold
      FROM "Product" p
      LEFT JOIN v ON v."productId" = p."id"
      LEFT JOIN s ON s."productId" = p."id"
      WHERE COALESCE(v.views, 0) > 0 OR COALESCE(s.sold, 0) > 0
      ORDER BY COALESCE(v.views, 0) DESC, COALESCE(s.sold, 0) DESC
      LIMIT ${INSIGHT_LIMIT}
    `;

    return rows.map((row) => {
      const views = Number(row.views);
      const sold = Number(row.sold);
      return {
        productId: row.productId,
        name: row.name,
        slug: row.slug,
        views,
        sold,
        conversion: views > 0 ? sold / views : null,
      };
    });
  }

  private async getTopSearches(since: Date): Promise<SearchInsightDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ term: string; count: bigint | number; zeroResults: bigint | number }>
    >`
      SELECT "term",
             SUM("count")::bigint AS count,
             SUM("zeroResults")::bigint AS "zeroResults"
      FROM "SearchQueryDaily"
      WHERE "day" >= ${since}::date
      GROUP BY "term"
      ORDER BY SUM("count") DESC
      LIMIT ${INSIGHT_LIMIT}
    `;
    return rows.map(toSearchInsight);
  }

  private async getZeroResultSearches(since: Date): Promise<SearchInsightDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ term: string; count: bigint | number; zeroResults: bigint | number }>
    >`
      SELECT "term",
             SUM("count")::bigint AS count,
             SUM("zeroResults")::bigint AS "zeroResults"
      FROM "SearchQueryDaily"
      WHERE "day" >= ${since}::date
      GROUP BY "term"
      HAVING SUM("zeroResults") > 0
      ORDER BY SUM("zeroResults") DESC
      LIMIT ${INSIGHT_LIMIT}
    `;
    return rows.map(toSearchInsight);
  }
}

/** SUM() của Postgres trả bigint — driver đưa về BigInt, JSON không tuần tự hoá được. */
function toSearchInsight(row: {
  term: string;
  count: bigint | number;
  zeroResults: bigint | number;
}): SearchInsightDto {
  return {
    term: row.term,
    count: Number(row.count),
    zeroResults: Number(row.zeroResults),
  };
}
