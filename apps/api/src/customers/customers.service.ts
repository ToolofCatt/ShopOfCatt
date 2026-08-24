import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import {
  isAdminRole,
  PASSWORD_MIN_LENGTH,
  type AdminCustomerDto,
  type AdminResetPasswordDto,
  type Paginated,
} from '@webcatt/shared';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';
import { CustomersQueryDto } from './dto/customers-query.dto';

const DEFAULT_CUSTOMERS_PAGE_SIZE = 20;
const BCRYPT_ROUNDS = 10;

/** Bỏ các ký tự dễ đọc nhầm khi chép tay: 0/O, 1/l/I. */
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const GENERATED_PASSWORD_LENGTH = Math.max(12, PASSWORD_MIN_LENGTH);

/** Mật khẩu ngẫu nhiên để admin đọc/gửi lại cho khách. */
function generatePassword(): string {
  let out = '';
  for (let i = 0; i < GENERATED_PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)];
  }
  return out;
}

type UserWithOrdersCount = User & { _count: { orders: number } };

/**
 * Tên hiển thị trong nhật ký thao tác: khách Telegram không có email nên rơi
 * về tên Telegram, cùng lắm là mã số — nhật ký ghi "null" thì admin không biết
 * mình vừa khoá ai.
 */
function customerLabel(user: User): string {
  return user.email ?? (user.telegramName.trim() !== '' ? user.telegramName : `#${user.code}`);
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: CustomersQueryDto): Promise<Paginated<AdminCustomerDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_CUSTOMERS_PAGE_SIZE;

    const where: Prisma.UserWhereInput = {};
    if (query.q) {
      // Tìm theo email hoặc tên Telegram (chứa, không phân biệt hoa thường),
      // hoặc mã số (bỏ dấu "#")
      const term = query.q.trim();
      const numeric = Number.parseInt(term.replace(/^#/, ''), 10);
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { telegramName: { contains: term, mode: 'insensitive' } },
      ];
      if (Number.isSafeInteger(numeric)) {
        where.OR.push({ code: numeric });
      }
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { orders: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);

    // Tổng chi tiêu của cả trang bằng MỘT truy vấn groupBy (không N+1)
    const spentMap = await this.getTotalSpentMap(users.map((u) => u.id));
    return {
      items: users.map((user) => this.toDto(user, spentMap.get(user.id) ?? 0)),
      total,
    };
  }

  async getOne(id: string): Promise<AdminCustomerDto> {
    const user = await this.loadUser(id);
    const spentMap = await this.getTotalSpentMap([id]);
    return this.toDto(user, spentMap.get(id) ?? 0);
  }

  /** Khóa tài khoản khách — không tự khóa mình, không khóa admin. */
  async lock(actor: User, id: string): Promise<AdminCustomerDto> {
    const target = await this.loadUser(id);
    if (target.id === actor.id) {
      throw new BadRequestException(K.cannotLockSelf);
    }
    if (isAdminRole(target.role)) {
      throw new BadRequestException(K.cannotLockAdmin);
    }
    await this.prisma.user.update({
      where: { id },
      // Đã khóa rồi thì giữ nguyên thời điểm khóa ban đầu (idempotent)
      data: { lockedAt: target.lockedAt ?? new Date() },
    });
    await this.audit.log(
      actor,
      'customer.lock',
      { type: 'user', id },
      { name: customerLabel(target) },
    );
    return this.getOne(id);
  }

  async unlock(actor: User, id: string): Promise<AdminCustomerDto> {
    const target = await this.loadUser(id);
    await this.prisma.user.update({
      where: { id },
      data: { lockedAt: null },
    });
    await this.audit.log(
      actor,
      'customer.unlock',
      { type: 'user', id },
      { name: customerLabel(target) },
    );
    return this.getOne(id);
  }

  /**
   * Đặt lại mật khẩu thay khách — quy trình "quên mật khẩu" của cửa hàng:
   * khách liên hệ admin, admin bấm nút này rồi gửi mật khẩu mới cho khách.
   * Mọi phiên đăng nhập cũ của tài khoản đó mất hiệu lực ngay lập tức.
   */
  async resetPassword(
    actor: User,
    id: string,
  ): Promise<AdminResetPasswordDto> {
    const target = await this.loadUser(id);
    if (target.id === actor.id) {
      throw new BadRequestException(K.cannotResetSelf);
    }
    if (target.role === 'SUPERADMIN') {
      throw new BadRequestException(K.cannotModifySuperadmin);
    }
    // Admin thường chỉ đặt lại được cho khách; tài khoản admin khác cần SUPERADMIN.
    if (isAdminRole(target.role) && actor.role !== 'SUPERADMIN') {
      throw new BadRequestException(K.cannotLockAdmin);
    }

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    await this.audit.log(
      actor,
      'customer.reset_password',
      { type: 'user', id },
      { name: customerLabel(target) },
    );
    return { password };
  }

  /** Cấp quyền quản trị (chỉ SUPERADMIN gọi được — SuperAdminGuard). */
  async grantAdmin(actor: User, id: string): Promise<AdminCustomerDto> {
    const target = await this.loadUser(id);
    if (target.role === 'SUPERADMIN') {
      throw new BadRequestException(K.cannotModifySuperadmin);
    }
    if (target.role === 'ADMIN') {
      throw new BadRequestException(K.alreadyAdmin);
    }
    if (target.lockedAt) {
      throw new BadRequestException(K.cannotGrantLocked);
    }
    await this.prisma.user.update({
      where: { id },
      data: { role: 'ADMIN' },
    });
    await this.audit.log(
      actor,
      'admin.grant',
      { type: 'user', id },
      { name: customerLabel(target) },
    );
    return this.getOne(id);
  }

  /** Thu hồi quyền quản trị (chỉ SUPERADMIN gọi được — SuperAdminGuard). */
  async revokeAdmin(actor: User, id: string): Promise<AdminCustomerDto> {
    const target = await this.loadUser(id);
    if (target.role === 'SUPERADMIN') {
      throw new BadRequestException(K.cannotModifySuperadmin);
    }
    if (target.role !== 'ADMIN') {
      throw new BadRequestException(K.notAdmin);
    }
    await this.prisma.user.update({
      where: { id },
      data: { role: 'USER' },
    });
    await this.audit.log(
      actor,
      'admin.revoke',
      { type: 'user', id },
      { name: customerLabel(target) },
    );
    return this.getOne(id);
  }

  // ---------- Nội bộ ----------

  private async loadUser(id: string): Promise<UserWithOrdersCount> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!user) {
      throw new NotFoundException(K.customerNotFound);
    }
    return user;
  }

  /** Σ totalAmount của đơn PAID + DELIVERED, khoá theo userId. */
  private async getTotalSpentMap(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (userIds.length === 0) return map;
    const grouped = await this.prisma.order.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        // Chỉ đơn PAID + DELIVERED được tính vào tổng chi tiêu
        status: { in: ['PAID', 'DELIVERED'] },
      },
      _sum: { totalAmount: true },
    });
    for (const group of grouped) {
      map.set(group.userId, Number(group._sum.totalAmount ?? 0));
    }
    return map;
  }

  private toDto(user: UserWithOrdersCount, totalSpent: number): AdminCustomerDto {
    return {
      id: user.id,
      code: user.code,
      email: user.email,
      telegramName: user.telegramName,
      balance: Number(user.balance),
      role: user.role,
      lockedAt: user.lockedAt ? user.lockedAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      ordersCount: user._count.orders,
      totalSpent,
    };
  }
}
