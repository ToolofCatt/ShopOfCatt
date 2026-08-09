import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { CaptchaDto } from '@webcatt/shared';

/** Câu hỏi sống 5 phút; dùng một lần rồi bỏ. */
const TTL_MS = 5 * 60_000;
/** Trần bộ nhớ — chặn việc gọi dồn dập làm phình RAM. */
const MAX_PENDING = 5_000;

interface Challenge {
  answer: number;
  expiresAt: number;
}

/**
 * Xác minh "người thật" bằng một phép tính đơn giản. Đáp án nằm ở máy chủ,
 * không bao giờ gửi cho trình duyệt, và mỗi câu hỏi chỉ dùng được MỘT lần —
 * nên không thể trả lời sẵn rồi phát lại nhiều lần để đăng ký hàng loạt.
 */
@Injectable()
export class CaptchaService {
  private readonly pending = new Map<string, Challenge>();

  issue(): CaptchaDto {
    this.sweep();
    const { question, answer } = buildChallenge();
    const id = randomUUID();
    this.pending.set(id, { answer, expiresAt: Date.now() + TTL_MS });
    return { id, question };
  }

  /** Đúng hay sai đều xóa khỏi bộ nhớ — không cho thử lại cùng một mã. */
  verify(id: string, rawAnswer: string): boolean {
    const challenge = this.pending.get(id);
    if (!challenge) return false;
    this.pending.delete(id);
    if (challenge.expiresAt < Date.now()) return false;
    const answer = Number.parseInt(rawAnswer.trim(), 10);
    return Number.isInteger(answer) && answer === challenge.answer;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, challenge] of this.pending) {
      if (challenge.expiresAt < now) this.pending.delete(id);
    }
    // Map giữ thứ tự chèn → phần tử đầu là cũ nhất.
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next();
      if (oldest.done) break;
      this.pending.delete(oldest.value);
    }
  }
}

/** Cộng / trừ / nhân với số nhỏ — đủ chặn bot đơn giản, không làm khó người dùng. */
function buildChallenge(): { question: string; answer: number } {
  const kind = randomInt(0, 3);
  if (kind === 0) {
    const a = randomInt(2, 20);
    const b = randomInt(2, 20);
    return { question: `${a} + ${b} = ?`, answer: a + b };
  }
  if (kind === 1) {
    const a = randomInt(11, 30);
    const b = randomInt(2, 10);
    return { question: `${a} - ${b} = ?`, answer: a - b };
  }
  const a = randomInt(2, 10);
  const b = randomInt(2, 10);
  return { question: `${a} × ${b} = ?`, answer: a * b };
}
