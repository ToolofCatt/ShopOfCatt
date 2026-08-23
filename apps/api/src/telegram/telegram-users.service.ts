import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { generateUniqueCustomerCode } from '../common/customer-code';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Khách Telegram là một `User` thật (Order.userId bắt buộc) — email null,
 * nhận diện bằng `telegramChatId`. Xem quyết định ở docs/BOT-TELEGRAM.md.
 */
@Injectable()
export class TelegramUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tra khách theo chat — null nếu chat này chưa từng mua gì. */
  findByChat(chatId: number): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { telegramChatId: String(chatId) },
    });
  }

  /**
   * Tra hoặc tạo khách cho một chat — gọi ở thời điểm khách BẮT ĐẦU MUA, không
   * phải lúc /start: chào hỏi không cần tài khoản, tạo sớm chỉ đổ rác vào bảng
   * khách hàng.
   */
  async findOrCreate(chatId: number, displayName: string): Promise<User> {
    const chat = String(chatId);
    const ten = displayName.trim().slice(0, 120);

    const existing = await this.prisma.user.findUnique({
      where: { telegramChatId: chat },
    });
    if (existing) {
      // Tên Telegram đổi theo thời gian — cập nhật để trang admin không hiện tên cũ.
      if (ten !== '' && ten !== existing.telegramName) {
        return this.prisma.user.update({
          where: { id: existing.id },
          data: { telegramName: ten },
        });
      }
      return existing;
    }

    /*
     * passwordHash là hash bcrypt THẬT của 32 byte ngẫu nhiên bị vứt ngay —
     * không ai (kể cả chủ shop) biết mật khẩu, nên tài khoản không đăng nhập
     * web được, nhưng mọi nhánh so mật khẩu vẫn chạy bình thường và luôn trượt
     * thay vì phải rào null ở từng chỗ gọi bcrypt.compare.
     */
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const code = await generateUniqueCustomerCode(async (candidate) => {
      const existed = await this.prisma.user.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      return existed !== null;
    });

    try {
      return await this.prisma.user.create({
        data: {
          email: null,
          passwordHash,
          code,
          telegramChatId: chat,
          telegramName: ten,
        },
      });
    } catch (err) {
      // Hai update của CÙNG một chat xử lý song song (khách bấm nút liên tiếp
      // đúng khe cooldown) — bên thua unique lấy lại bản ghi bên thắng vừa tạo.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.user.findUnique({
          where: { telegramChatId: chat },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }
}
