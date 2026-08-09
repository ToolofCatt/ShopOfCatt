'use client';

import { useState } from 'react';
import type { ProductDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { Badge, Card } from '@/components/ui';
import { StockManager } from '@/components/admin/stock-manager';
import { Tabs, type TabItem } from '@/components/admin/tabs';

export interface VariantStockPanelProps {
  product: ProductDto;
  /** Tải lại sản phẩm sau khi kho thay đổi (cập nhật số tồn của từng loại). */
  onStockChanged: () => void;
}

/**
 * Kho hàng theo loại: bộ chọn loại ở trên, bảng kho của loại đang chọn ở dưới.
 * Mỗi loại có kho riêng nên StockManager được gắn khoá theo id loại để reset
 * ô nhập / phân trang khi đổi loại.
 */
export function VariantStockPanel({ product, onStockChanged }: VariantStockPanelProps) {
  const { t } = useI18n();
  const { variants } = product;

  const [requestedId, setRequestedId] = useState<string | null>(null);
  // Loại đang chọn có thể vừa bị xóa → luôn rơi về loại đầu tiên còn lại.
  const selected = variants.find((variant) => variant.id === requestedId) ?? variants[0] ?? null;

  const tabs: TabItem<string>[] = variants.map((variant) => ({
    value: variant.id,
    label: variant.name,
  }));

  return (
    <Card className="p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
          {t.admin.stockTitle}
        </h2>
        <p className="text-sm text-neutral-500">{t.admin.stockSubtitle}</p>
      </div>

      {selected === null ? (
        <p className="mt-4 rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
          {t.admin.stockNoVariant}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {variants.length > 1 ? (
              <>
                <span className="text-sm text-neutral-500">{t.admin.stockVariantPicker}</span>
                <Tabs items={tabs} value={selected.id} onChange={setRequestedId} />
              </>
            ) : (
              <span className="text-sm text-neutral-500">
                {t.admin.stockVariantSingle(selected.name)}
              </span>
            )}
            <Badge variant="outline" className="ml-auto tabular-nums">
              {t.admin.variantStockLine(selected.availableStock, selected.sold)}
            </Badge>
          </div>

          <div className="mt-4">
            <StockManager
              key={selected.id}
              variantId={selected.id}
              onStockChanged={onStockChanged}
            />
          </div>
        </>
      )}
    </Card>
  );
}
