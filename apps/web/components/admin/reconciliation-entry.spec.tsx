import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { adminUxEn } from '../../lib/i18n/dictionaries/admin-ux';
import { ReconciliationEntry, type ReconciliationSummaryState } from './reconciliation-entry';

function render(state: ReconciliationSummaryState) {
  return renderToStaticMarkup(createElement(ReconciliationEntry, {
    state,
    copy: adminUxEn,
    retryLabel: 'Retry',
    onRetry: () => undefined,
  }));
}

describe('dashboard reconciliation entry', () => {
  it('keeps the workspace reachable when counts fail and offers retry rather than zero', () => {
    const html = render({ status: 'error' });
    expect(html).toContain('href="/admin/reconciliation"');
    expect(html).toContain(adminUxEn.reconciliationUnavailable);
    expect(html).toContain('role="status"');
    expect(html).toContain('>Retry</button>');
    expect(html).not.toContain('0 unresolved transfers');
  });

  it('keeps unknown counts distinct from zero while the summary loads', () => {
    const html = render({ status: 'loading' });
    expect(html).toContain('href="/admin/reconciliation"');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('0 unresolved transfers');
    expect(html).not.toContain(adminUxEn.reconciliationUnavailable);
  });

  it('shows separate unresolved and conflict counts without adding them together', () => {
    const html = render({ status: 'ready', unresolved: 5, conflicts: 2 });
    expect(html).toContain('5 unresolved transfers');
    expect(html).toContain('2 conflicting transactions');
    expect(html).not.toContain('7 unresolved transfers');
    expect(html).toContain('href="/admin/reconciliation"');
  });

  it('keeps the entry visible when there is nothing to reconcile', () => {
    const html = render({ status: 'ready', unresolved: 0, conflicts: 0 });
    expect(html).toContain('0 unresolved transfers');
    expect(html).toContain('0 conflicting transactions');
    expect(html).toContain('href="/admin/reconciliation"');
  });
});
