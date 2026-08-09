'use client';

import type { OrderStatus } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { Badge, ORDER_STATUS_BADGE_VARIANT } from '@/components/ui';

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Badge variant={ORDER_STATUS_BADGE_VARIANT[status]} className={className}>
      {t.orderStatus[status]}
    </Badge>
  );
}
