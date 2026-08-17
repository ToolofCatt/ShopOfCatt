import type { Order, OrderItem, Payment, StockItem } from '@prisma/client';
import type {
  CryptoNetwork,
  OrderDetailDto,
  OrderItemDto,
  OrderSummaryDto,
  PaymentInfoDto,
  PaymentMode,
} from '@webcatt/shared';
import { cryptoAddressQr } from './crypto-qr';

export type OrderWithRelations = Order & {
  items: Array<
    OrderItem & { stockItems: StockItem[]; product: { slug: string } }
  >;
  payment: Payment | null;
};

export type OrderForSummary = Order & {
  items: Array<Pick<OrderItem, 'productName'>>;
};

export function toPaymentInfoDto(
  payment: Payment,
  orderCode: string,
): PaymentInfoDto {
  const mode: PaymentMode =
    payment.mode === 'BINANCE'
      ? 'BINANCE'
      : payment.mode === 'CRYPTO'
        ? 'CRYPTO'
        : 'MOCK';
  const dto: PaymentInfoDto = {
    mode,
    status: payment.status,
    merchantTradeNo: payment.merchantTradeNo,
  };
  if (mode === 'MOCK') {
    dto.mockPayUrl = `/mock-pay/${orderCode}`;
  } else if (mode === 'CRYPTO') {
    if (payment.cryptoNetwork) {
      dto.cryptoNetwork = payment.cryptoNetwork as CryptoNetwork;
    }
    if (payment.cryptoAddress) {
      dto.cryptoAddress = payment.cryptoAddress;
      // QR dựng từ địa chỉ ĐÃ CHỐT TRONG ĐƠN, không phải địa chỉ hiện tại trong
      // cấu hình: chủ shop đổi ví sau đó thì đơn đang chờ vẫn phải trỏ đúng chỗ
      // khách được báo lúc đầu.
      const qr = cryptoAddressQr(payment.cryptoAddress);
      if (qr) dto.cryptoQr = qr;
    }
    if (payment.cryptoAmount !== null) {
      dto.cryptoAmount = Number(payment.cryptoAmount);
    }
    if (payment.cryptoTxId) dto.cryptoTxId = payment.cryptoTxId;
  } else {
    if (payment.checkoutUrl) dto.checkoutUrl = payment.checkoutUrl;
    if (payment.qrcodeLink) dto.qrcodeLink = payment.qrcodeLink;
    if (payment.deeplink) dto.deeplink = payment.deeplink;
    if (payment.universalUrl) dto.universalUrl = payment.universalUrl;
    if (payment.prepayId) dto.prepayId = payment.prepayId;
  }
  return dto;
}

/**
 * `includeAllLines` (admin): luôn kèm mọi dòng kho đã gán cho order item.
 * Mặc định (khách hàng): chỉ kèm dòng SOLD khi đơn DELIVERED, hoặc khi đơn
 * PAID mà đã có dòng được giao một phần.
 */
export function toOrderDetailDto(
  order: OrderWithRelations,
  options: { includeAllLines?: boolean } = {},
): OrderDetailDto {
  const items: OrderItemDto[] = order.items.map((item) => {
    const dto: OrderItemDto = {
      id: item.id,
      productId: item.productId,
      productSlug: item.product.slug,
      productName: item.productName,
      variantName: item.variantName,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
    };
    if (options.includeAllLines) {
      dto.deliveredLines = item.stockItems.map((s) => s.content);
    } else if (order.status === 'DELIVERED' || order.status === 'PAID') {
      const lines = item.stockItems
        .filter((s) => s.status === 'SOLD')
        .map((s) => s.content);
      if (order.status === 'DELIVERED' || lines.length > 0) {
        dto.deliveredLines = lines;
      }
    }
    return dto;
  });

  return {
    id: order.id,
    code: order.code,
    status: order.status,
    subtotalAmount: Number(order.subtotalAmount),
    discountAmount: Number(order.discountAmount),
    couponCode: order.couponCode,
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt ? order.expiresAt.toISOString() : null,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    items,
    payment: order.payment
      ? toPaymentInfoDto(order.payment, order.code)
      : null,
  };
}

export function toOrderSummaryDto(
  order: OrderForSummary,
  buyer?: { email: string; code: number },
): OrderSummaryDto {
  const dto: OrderSummaryDto = {
    code: order.code,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    itemsCount: order.items.length,
    firstProductName: order.items[0]?.productName ?? '',
  };
  if (buyer) {
    dto.userEmail = buyer.email;
    dto.userCode = buyer.code;
  }
  return dto;
}
