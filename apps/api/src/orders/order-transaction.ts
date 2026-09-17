import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma, type Product, type ProductVariant, type User } from '@prisma/client';
import { calcDiscount, type DiscountType } from '@webcatt/shared';
import { generateMerchantTradeNo, generateOrderCode } from '../common/codes';
import { CouponsService } from '../coupons/coupons.service';
import { K } from '../i18n/messages';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { FulfillmentService } from './fulfillment.service';

export interface PendingOrderOptions {
  telegramCallbackId?: string;
  ownerAlertQueued?: boolean;
}

export interface PreparedOrder {
  readonly orderId: string;
  readonly code: string;
  readonly total: Prisma.Decimal;
  readonly reservationPlan: ReadonlyArray<{
    orderItemId: string;
    variantId: string;
    quantity: number;
    name: string;
  }>;
}

/** Caller giữ arbitration/callback trước khi vào đây. Đơn mới chưa công bố nên
 * được chốt Coupon → Product/Variant trước INSERT, nhưng Payment/OrderItem phải
 * tồn tại TRƯỚC User/Stock để mua bằng ví không đảo khóa hoặc phải giữ kho hai lần. */
export async function createPendingOrderInTransaction(
  tx: Prisma.TransactionClient,
  user: Pick<User, 'id'>,
  dto: CreateOrderDto,
  paymentMode: 'INITIALIZING' | 'BALANCE',
  dependencies: { coupons: Pick<CouponsService, 'reserve'>; expireMinutes: number },
  options: PendingOrderOptions = {},
): Promise<PreparedOrder> {
  const merged = new Map<string, number>();
  for (const item of dto.items) {
    merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
  }

  let coupon = null;
  const rawCoupon = dto.couponCode?.trim() ?? '';
  if (rawCoupon) {
    const code = CouponsService.normalize(rawCoupon);
    if (!/^[A-Z0-9-]{1,32}$/.test(code)) throw new BadRequestException(K.couponCodeInvalid);
    coupon = await tx.coupon.findUnique({ where: { code } });
    if (!coupon) throw new BadRequestException(K.couponNotFound);
    await dependencies.coupons.reserve(tx, coupon, user.id);
    // reserve khóa và kiểm quota bằng bản hiện hành; giá trị giảm cũng phải
    // đọc SAU khóa, không dùng ảnh preview cũ nếu admin vừa sửa mã.
    coupon = await tx.coupon.findUnique({ where: { id: coupon.id } });
    if (!coupon) throw new BadRequestException(K.couponNotFound);
  }
  const productIds = [...new Set((await tx.productVariant.findMany({
    where: { id: { in: [...merged.keys()] } }, select: { productId: true },
  })).map((variant) => variant.productId))].sort();
  for (const productId of productIds) {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR KEY SHARE`;
  }
  const items: { variant: ProductVariant & { product: Product }; quantity: number }[] = [];
  let subtotalAmount = new Prisma.Decimal(0);
  for (const [variantId, quantity] of [...merged].sort(([a], [b]) => a.localeCompare(b))) {
    await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR KEY SHARE`;
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, active: true, product: { active: true } },
      include: { product: true },
    });
    if (!variant) throw new NotFoundException(K.variantNotFound);
    subtotalAmount = subtotalAmount.add(variant.price.mul(quantity));
    items.push({ variant, quantity });
  }

  let discountAmount = new Prisma.Decimal(0);
  if (coupon) {
    const subtotal = Number(subtotalAmount);
    if (subtotal < Number(coupon.minAmount)) {
      throw new BadRequestException({ key: K.couponMinAmount, params: { min: Number(coupon.minAmount).toFixed(2) } });
    }
    discountAmount = new Prisma.Decimal(calcDiscount(subtotal, coupon.type as DiscountType, Number(coupon.value)));
  }
  const total = subtotalAmount.sub(discountAmount);
  const code = await generateUniqueOrderCode(tx);
  const order = await tx.order.create({
    data: {
      code, userId: user.id, status: 'PENDING', subtotalAmount, discountAmount,
      totalAmount: total, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null,
      currency: 'USDT', expiresAt: new Date(Date.now() + dependencies.expireMinutes * 60_000),
      telegramCallbackId: options.telegramCallbackId?.trim() || null,
      // Không dội lại thông báo lịch sử khi chủ shop bật bot sau này.
      telegramOwnerNewOrderNotifiedAt: options.ownerAlertQueued ? null : new Date(),
    },
  });
  await tx.payment.create({
    data: {
      orderId: order.id, provider: 'BINANCE_PAY', mode: paymentMode,
      merchantTradeNo: generateMerchantTradeNo(code), amount: total, currency: 'USDT', status: 'PENDING',
    },
  });
  const reservationPlan: PreparedOrder['reservationPlan'][number][] = [];
  for (const { variant, quantity } of items) {
    const orderItem = await tx.orderItem.create({
      data: {
        orderId: order.id, productId: variant.productId, variantId: variant.id,
        productName: variant.product.name, variantName: variant.name, unitPrice: variant.price, quantity,
      },
    });
    reservationPlan.push({ orderItemId: orderItem.id, variantId: variant.id, quantity, name: `${variant.product.name} – ${variant.name}` });
  }
  return { orderId: order.id, code, total, reservationPlan };
}

/** Chỉ gọi với PreparedOrder mới tạo trong CÙNG tx, sau debit nếu trả bằng ví.
 * Không bắt lỗi: thiếu một key phải rollback cả tiền, coupon, đơn và receipt. */
export async function reserveOrderStockInTransaction(
  tx: Prisma.TransactionClient,
  prepared: PreparedOrder,
  fulfillment: Pick<FulfillmentService, 'lockAvailableStock'>,
): Promise<void> {
  for (const item of prepared.reservationPlan) {
    const stockIds = await fulfillment.lockAvailableStock(tx, item.variantId, item.quantity);
    if (stockIds.length < item.quantity) {
      const remaining = await tx.stockItem.count({ where: { variantId: item.variantId, status: 'AVAILABLE' } });
      throw new BadRequestException({ key: K.orderInsufficientStock, params: { name: item.name, remaining } });
    }
    const reserved = await tx.stockItem.updateMany({
      where: { id: { in: stockIds }, status: 'AVAILABLE' },
      data: { status: 'RESERVED', orderItemId: item.orderItemId },
    });
    if (reserved.count !== item.quantity) throw new BadRequestException(K.orderInsufficientStock);
  }
}

async function generateUniqueOrderCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateOrderCode();
    if (!(await tx.order.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new InternalServerErrorException(K.orderCodeFailed);
}
