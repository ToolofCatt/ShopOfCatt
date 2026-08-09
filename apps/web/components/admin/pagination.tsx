'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

export interface PaginationProps {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Table pagination row: "showing x–y of total" + prev/next controls. */
export function Pagination({ page, total, limit, onPageChange, className }: PaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-sm tabular-nums text-neutral-500">
        {t.admin.paginationShowing(from, to, total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft strokeWidth={1.75} className="h-4 w-4" />
          {t.admin.paginationPrev}
        </Button>
        <span className="text-sm tabular-nums text-neutral-500">
          {t.admin.paginationPage(page, totalPages)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t.admin.paginationNext}
          <ChevronRight strokeWidth={1.75} className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
