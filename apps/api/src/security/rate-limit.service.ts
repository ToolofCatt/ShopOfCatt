import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Dọn rác tối đa mỗi phút một lần. */
const SWEEP_EVERY_MS = 60_000;
/** Khoá không hoạt động quá 1 giờ thì bỏ. */
const STALE_AFTER_MS = 60 * 60_000;

/**
 * Giới hạn tần suất theo cửa sổ trượt, lưu trong bộ nhớ tiến trình.
 * Đủ cho một cửa hàng chạy một tiến trình; nếu sau này chạy nhiều tiến trình
 * thì thay bằng Redis mà giữ nguyên giao diện `hit`/`reset`.
 */
@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, number[]>();
  private lastSweep = 0;

  /** true = còn hạn mức (đã tính lần gọi này); false = đã vượt. */
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.sweep(now);
    const recent = (this.buckets.get(key) ?? []).filter(
      (at) => now - at < windowMs,
    );
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    this.buckets.set(key, recent);
    return true;
  }

  /** Xóa hạn mức của một khóa — gọi sau khi đăng nhập thành công. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [key, hits] of this.buckets) {
      const last = hits[hits.length - 1];
      if (last === undefined || now - last > STALE_AFTER_MS) {
        this.buckets.delete(key);
      }
    }
  }
}

/** IP của client — dùng làm khóa giới hạn tần suất. */
export function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
