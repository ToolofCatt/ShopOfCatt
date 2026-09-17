import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiPrincipal } from './api-principal';

export class ApiQuotaExceeded extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(K.tooManyRequests, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface Bucket { prefix: string; limit: number }
interface BucketHit { hits: number; retryAfterSeconds: number }

@Injectable()
export class ApiQuotaService {
  private lastSweep = 0;

  constructor(private readonly prisma: PrismaService) {}

  async consumeRequest(principal: ApiPrincipal, method: string): Promise<void> {
    const read = method === 'GET' || method === 'HEAD';
    const operation = read ? 'read' : 'write';
    await this.consume([
      { prefix: `key:${principal.keyId}:${operation}`, limit: read ? 120 : 30 },
      { prefix: `owner:${principal.ownerId}:${operation}`, limit: read ? 240 : 30 },
    ], 60);
  }

  async consumeCreation(ownerId: string): Promise<void> {
    await this.consume([{ prefix: `owner:${ownerId}:create-key`, limit: 5 }], 3_600);
  }

  private async consume(buckets: Bucket[], seconds: number): Promise<void> {
    const sweep = Date.now() - this.lastSweep >= 60_000;
    if (sweep) this.lastSweep = Date.now();
    const exceeded = await this.prisma.$transaction(async (tx) => {
      if (sweep) {
        // Không dọn vô hạn hoặc tranh bucket đang dùng khi nhiều instance cùng chạy.
        await tx.$executeRaw`
          WITH expired AS (
            SELECT "id" FROM "ApiRateBucket" WHERE "expiresAt" < clock_timestamp()
            ORDER BY "expiresAt", "id" LIMIT 500 FOR UPDATE SKIP LOCKED
          )
          DELETE FROM "ApiRateBucket" USING expired WHERE "ApiRateBucket"."id" = expired."id"
        `;
      }
      let retryAfter = 0;
      // Thứ tự key → owner cố định để các instance không khóa bucket đảo nhau.
      for (const bucket of buckets) {
        const [result] = await tx.$queryRaw<BucketHit[]>`
          WITH bucket_window AS (
            SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp()) / ${seconds}) * ${seconds}) AS started
          )
          INSERT INTO "ApiRateBucket" ("id", "hits", "expiresAt")
          SELECT ${bucket.prefix} || ':' || extract(epoch FROM started)::bigint::text,
                 1, started + ${seconds} * interval '1 second'
          FROM bucket_window
          ON CONFLICT ("id") DO UPDATE
            SET "hits" = LEAST("ApiRateBucket"."hits"::bigint + 1, 2147483647)::integer
          RETURNING "hits", GREATEST(1, ceil(extract(epoch FROM ("expiresAt" - clock_timestamp()))))::integer AS "retryAfterSeconds"
        `;
        if (result.hits > bucket.limit) retryAfter = Math.max(retryAfter, result.retryAfterSeconds);
      }
      return retryAfter;
    });
    // Ném sau commit: request quá quota hoặc nghiệp vụ rollback không được trả lại lượt.
    if (exceeded > 0) throw new ApiQuotaExceeded(exceeded);
  }
}
