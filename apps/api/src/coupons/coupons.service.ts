import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Coupon, type User } from '@prisma/client';
import {
  calcDiscount,
  type AdminCouponDto,
  type CouponPreviewDto,
  type DiscountType,
} from '@webcatt/shared';
import { diffChanges } from '../audit/audit-diff';
import { AuditService } from '../audit/audit.service';
import { K } from '../i18n/messages';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderItemDto } from '../orders/dto/create-order.dto';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon-admin.dto';
import { PreviewCouponDto } from './dto/preview-coupon.dto';

/** Chỉ chữ, số và gạch ngang — tránh mã khó gõ / dễ nhầm. */
const CODE_RE = /^[A-Z0-9-]{1,32}$/;

/** Đơn ở các trạng thái này được tính là đã dùng một lượt của mã. */
const COUNTED_STATUSES: Prisma.EnumOrderStatusFilter = {
  in: ['PENDING', 'PAID', 'DELIVERED'],
};

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Chuẩn hóa mã: bỏ khoảng trắng, viết HOA. */
  static normalize(raw: string): string {
    return raw.trim().toUpperCase();
  }

  /**
   * Tiền hàng tính từ GIÁ TRONG CSDL — không bao giờ tin số tiền client gửi lên.
   * Bỏ qua loại không tồn tại/ngừng bán (khâu đặt hàng sẽ báo lỗi riêng).
   */
  async computeSubtotal(items: CreateOrderItemDto[]): Promise<number> {
    const merged = new Map<string, number>();
    for (const item of items) {
      merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
    }
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: [...merged.keys()] }, active: true },
      select: { id: true, price: true },
    });
    let subtotal = new Prisma.Decimal(0);
    for (const variant of variants) {
      subtotal = subtotal.add(variant.price.mul(merged.get(variant.id) ?? 0));
    }
    return Number(subtotal);
  }

  /**
   * Kiểm tra mã có dùng được cho khách này với số tiền hàng này không.
   * Ném lỗi kèm khóa thông báo nếu không; trả về mã + số tiền được giảm nếu có.
   */
  async validate(
    userId: string,
    rawCode: string,
    subtotal: number,
  ): Promise<{ coupon: Coupon; discountAmount: number }> {
    const code = CouponsService.normalize(rawCode);
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(K.couponCodeInvalid);
    }

    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      throw new BadRequestException(K.couponNotFound);
    }
    if (!coupon.active) {
      throw new BadRequestException(K.couponInactive);
    }

    const now = new Date();
    if (coupon.startsAt && now < coupon.startsAt) {
      throw new BadRequestException(K.couponNotStarted);
    }
    if (coupon.expiresAt && now > coupon.expiresAt) {
      throw new BadRequestException(K.couponExpired);
    }
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException(K.couponExhausted);
    }
    if (coupon.perUserLimit !== null) {
      const used = await this.prisma.order.count({
        where: { userId, couponId: coupon.id, status: COUNTED_STATUSES },
      });
      if (used >= coupon.perUserLimit) {
        throw new BadRequestException(K.couponUserLimit);
      }
    }

    const minAmount = Number(coupon.minAmount);
    if (subtotal < minAmount) {
      throw new BadRequestException({
        key: K.couponMinAmount,
        params: { min: minAmount.toFixed(2) },
      });
    }

    const discountAmount = calcDiscount(
      subtotal,
      coupon.type as DiscountType,
      Number(coupon.value),
    );
    return { coupon, discountAmount };
  }

  /** Xem trước cho trang sản phẩm — tính lại tiền hàng từ CSDL. */
  async preview(userId: string, dto: PreviewCouponDto): Promise<CouponPreviewDto> {
    const subtotal = await this.computeSubtotal(dto.items);
    const { coupon, discountAmount } = await this.validate(
      userId,
      dto.code,
      subtotal,
    );
    return {
      code: coupon.code,
      type: coupon.type as DiscountType,
      value: Number(coupon.value),
      subtotal,
      discountAmount,
      totalAmount: Math.round((subtotal - discountAmount) * 100) / 100,
    };
  }

  /**
   * GIỮ CHỖ một lượt dùng, nguyên tử: `updateMany` chỉ tăng khi `usedCount`
   * còn dưới hạn mức, nên hai đơn đặt cùng lúc không thể vượt `maxUses`.
   * Lượt này được trả lại nếu đơn bị hủy/hết hạn.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    coupon: Coupon,
  ): Promise<void> {
    const where: Prisma.CouponWhereInput =
      coupon.maxUses === null
        ? { id: coupon.id, active: true }
        : { id: coupon.id, active: true, usedCount: { lt: coupon.maxUses } };
    const taken = await tx.coupon.updateMany({
      where,
      data: { usedCount: { increment: 1 } },
    });
    if (taken.count === 0) {
      throw new BadRequestException(K.couponExhausted);
    }
  }

  // ---------- Quản trị ----------

  async list(): Promise<AdminCouponDto[]> {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return coupons.map(toAdminDto);
  }

  async create(actor: User, dto: CreateCouponDto): Promise<AdminCouponDto> {
    const code = CouponsService.normalize(dto.code);
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(K.couponCodeInvalid);
    }
    if (dto.type === 'PERCENT' && (dto.value < 1 || dto.value > 100)) {
      throw new BadRequestException(K.couponPercentRange);
    }
    const existing = await this.prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(K.couponCodeTaken);
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code,
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        minAmount: new Prisma.Decimal(dto.minAmount ?? 0),
        maxUses: dto.maxUses ?? null,
        perUserLimit: dto.perUserLimit ?? null,
        startsAt: parseDate(dto.startsAt),
        expiresAt: parseDate(dto.expiresAt),
        active: dto.active ?? true,
        note: dto.note?.trim() || null,
      },
    });
    await this.audit.log(actor, 'coupon.create', {
      type: 'coupon',
      id: coupon.id,
    }, { code: coupon.code });
    return toAdminDto(coupon);
  }

  async update(
    actor: User,
    id: string,
    dto: UpdateCouponDto,
  ): Promise<AdminCouponDto> {
    const before = await this.prisma.coupon.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException(K.couponNotFoundAdmin);
    }

    const type = dto.type ?? (before.type as DiscountType);
    const value = dto.value ?? Number(before.value);
    if (type === 'PERCENT' && (value < 1 || value > 100)) {
      throw new BadRequestException(K.couponPercentRange);
    }

    // undefined = giữ nguyên; null = xóa giới hạn.
    const data: Prisma.CouponUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = new Prisma.Decimal(dto.value);
    if (dto.minAmount !== undefined) {
      data.minAmount = new Prisma.Decimal(dto.minAmount);
    }
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.perUserLimit !== undefined) data.perUserLimit = dto.perUserLimit;
    if (dto.startsAt !== undefined) data.startsAt = parseDate(dto.startsAt);
    if (dto.expiresAt !== undefined) data.expiresAt = parseDate(dto.expiresAt);
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;

    const updated = await this.prisma.coupon.update({ where: { id }, data });
    const changes = diffChanges(toSnapshot(before), toSnapshot(updated));
    await this.audit.log(
      actor,
      'coupon.update',
      { type: 'coupon', id },
      { code: updated.code, ...(Object.keys(changes).length > 0 ? { changes } : {}) },
    );
    return toAdminDto(updated);
  }

  /**
   * Xóa mã. Đơn đã dùng vẫn giữ `couponCode` (ảnh chụp) nhờ `onDelete: SetNull`
   * ở khóa ngoại, nên lịch sử đơn hàng không mất thông tin.
   */
  async remove(actor: User, id: string): Promise<{ success: boolean }> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException(K.couponNotFoundAdmin);
    }
    await this.prisma.coupon.delete({ where: { id } });
    await this.audit.log(actor, 'coupon.delete', { type: 'coupon', id }, {
      code: coupon.code,
    });
    return { success: true };
  }
}

/** "" / undefined → null; chuỗi không parse được → lỗi. */
function parseDate(raw: string | null | undefined): Date | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(K.couponDateInvalid);
  }
  return date;
}

function toAdminDto(coupon: Coupon): AdminCouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type as DiscountType,
    value: Number(coupon.value),
    minAmount: Number(coupon.minAmount),
    maxUses: coupon.maxUses,
    usedCount: coupon.usedCount,
    perUserLimit: coupon.perUserLimit,
    startsAt: coupon.startsAt ? coupon.startsAt.toISOString() : null,
    expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString() : null,
    active: coupon.active,
    note: coupon.note,
    createdAt: coupon.createdAt.toISOString(),
  };
}

/** Ảnh chụp phẳng để diff cho nhật ký. */
function toSnapshot(coupon: Coupon): Record<string, unknown> {
  return {
    type: coupon.type,
    value: Number(coupon.value),
    minAmount: Number(coupon.minAmount),
    maxUses: coupon.maxUses,
    perUserLimit: coupon.perUserLimit,
    startsAt: coupon.startsAt ? coupon.startsAt.toISOString() : null,
    expiresAt: coupon.expiresAt ? coupon.expiresAt.toISOString() : null,
    active: coupon.active,
    note: coupon.note,
  };
}
