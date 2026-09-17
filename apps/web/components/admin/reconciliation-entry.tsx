import Link from 'next/link';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import type { ReconciliationSummaryDto } from '@webcatt/shared';
import type { adminUxVi } from '../../lib/i18n/dictionaries/admin-ux';

export type ReconciliationSummaryState =
  | { status: 'loading' }
  | { status: 'error' }
  | ({ status: 'ready' } & ReconciliationSummaryDto);

interface ReconciliationEntryProps {
  state: ReconciliationSummaryState;
  copy: typeof adminUxVi;
  retryLabel: string;
  onRetry: () => void;
}

export function ReconciliationEntry({ state, copy, retryLabel, onRetry }: ReconciliationEntryProps) {
  return (
    <div className="mt-4 min-w-0 border-t border-neutral-200 pt-4">
      <Link
        href="/admin/reconciliation"
        className="group flex min-h-11 items-start gap-2 rounded-lg text-sm text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
      >
        <ArrowLeftRight aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium underline-offset-4 group-hover:underline">{copy.reconciliation}</span>
          <span className="mt-1 block text-xs text-neutral-500">{copy.reconciliationDescription}</span>
        </span>
        <ArrowRight aria-hidden="true" strokeWidth={1.75} className="mt-0.5 h-4 w-4 shrink-0" />
      </Link>
      <div role="status" aria-busy={state.status === 'loading'} className="mt-2 text-xs text-neutral-600">
        {state.status === 'loading' ? (
          <span aria-hidden="true">—</span>
        ) : state.status === 'error' ? (
          <>
            <p>{copy.reconciliationUnavailable}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 min-h-11 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 md:min-h-0"
            >{retryLabel}</button>
          </>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
            <span className={state.unresolved > 0 ? 'font-medium text-neutral-950' : undefined}>
              {copy.reconciliationUnresolved(state.unresolved)}
            </span>
            <span>{copy.reconciliationConflicts(state.conflicts)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
