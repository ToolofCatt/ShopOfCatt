import type { OrderDetailDto, OrderItemDto } from '@webcatt/shared';

export function getCustomerDelivery(order: Pick<OrderDetailDto, 'status'> & { items: Pick<OrderItemDto, 'quantity' | 'deliveredLines'>[] }) {
  const total = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const delivered = order.items.reduce((sum, item) => sum + Math.min(item.quantity, item.deliveredLines?.length ?? 0), 0);
  // Không suy ra đã nhận tiền từ query ?paid=1 hay một dòng key đơn lẻ.
  const kind = order.status === 'DELIVERED' ? 'delivered'
    : order.status !== 'PAID' ? 'unconfirmed'
    : delivered === 0 ? 'waiting'
    : delivered < total ? 'partial' : 'available';
  return { kind, delivered, total };
}
