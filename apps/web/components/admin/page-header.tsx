import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Admin page heading row: title + optional muted description + right-side actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 max-w-full break-words">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&>a]:min-h-11 [&>button]:min-h-11 md:[&>a]:min-h-0 md:[&>button]:min-h-0">{actions}</div>}
    </div>
  );
}
