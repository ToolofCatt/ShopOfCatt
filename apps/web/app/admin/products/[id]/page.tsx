'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, PackageX, ServerCrash } from 'lucide-react';
import type { ProductDto } from '@webcatt/shared';
import { ApiError, apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Badge, Button, EmptyState, Spinner, buttonVariants } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { ProductForm } from '@/components/admin/product-form';
import { VariantManager } from '@/components/admin/variant-manager';
import { VariantStockPanel } from '@/components/admin/variant-stock-panel';
import { formatProductPrice } from '@/components/admin/helpers';

export default function AdminEditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token } = useAuth();
  const { t } = useI18n();

  const [product, setProduct] = useState<ProductDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Endpoint riêng cho MỘT sản phẩm.
   *
   * Trước đây trang này gọi `GET /admin/products` rồi tự tìm theo id: kéo cả
   * kho sản phẩm về chỉ để dùng một cái. Quan trọng hơn, endpoint danh sách cố
   * ý KHÔNG trả ảnh phụ (mỗi sản phẩm tới 5 tấm base64), nên trình quản lý ảnh
   * sẽ không bao giờ nhận được dữ liệu qua đường đó.
   */
  const loadProduct = useCallback(async () => {
    try {
      return await apiFetch<ProductDto>(`/admin/products/${id}`, { token });
    } catch (err) {
      // 404 = sản phẩm đã bị xoá ở nơi khác → hiện màn hình "không tìm thấy"
      // chứ không phải màn hình lỗi kết nối.
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [id, token]);

  useEffect(() => {
    let active = true;
    loadProduct()
      .then((found) => {
        if (!active) return;
        setProduct(found);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [loadProduct, t]);

  /** Nạp lại sản phẩm sau khi loại / kho thay đổi (giá, tồn kho, đã bán). */
  const refresh = useCallback(async () => {
    const found = await loadProduct();
    if (found) setProduct(found);
  }, [loadProduct]);

  // Bộ đếm kho chỉ mang tính hiển thị — lỗi nạp lại không chặn thao tác.
  const refreshQuietly = useCallback(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  if (error) {
    return (
      <EmptyState
        icon={ServerCrash}
        title={t.admin.editProductError}
        hint={error}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  if (!product) {
    return (
      <EmptyState
        icon={PackageX}
        title={t.admin.productMissingTitle}
        hint={t.admin.productMissingHint}
        action={
          <Link href="/admin/products" className={buttonVariants({ variant: 'outline' })}>
            {t.admin.backToProducts}
          </Link>
        }
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/admin/products"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-neutral-500 transition-colors hover:text-neutral-950"
      >
        <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
        {t.admin.navProducts}
      </Link>
      <PageHeader
        title={product.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">/{product.slug}</span>
            <span>{formatProductPrice(product, t)}</span>
            <span>{t.admin.variantCount(product.variants.length)}</span>
            <span>
              {t.admin.stockLabel}: <span className="tabular-nums">{product.availableStock}</span> •{' '}
              {t.admin.soldLabel}: <span className="tabular-nums">{product.sold}</span>
            </span>
          </span>
        }
        actions={
          <Badge variant={product.active ? 'solid' : 'muted'}>
            {product.active ? t.admin.visible : t.admin.hidden}
          </Badge>
        }
      />

      <div className="space-y-6">
        <ProductForm product={product} onProductUpdated={setProduct} />
        <VariantManager product={product} onChanged={refresh} />
        <VariantStockPanel product={product} onStockChanged={refreshQuietly} />
      </div>
    </div>
  );
}
