'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ScrollText, ServerCrash } from 'lucide-react';
import {
  AUDIT_ACTIONS,
  formatUserCode,
  type AuditAction,
  type AuditLogDto,
  type Paginated,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { SELECT_CLASSES } from '@/components/admin/helpers';

const PAGE_SIZE = 50;

type ActionFilter = AuditAction | 'ALL';

/** Nhóm hành động cho <optgroup> — mọi khoá đều nằm trong AUDIT_ACTIONS. */
const ACTION_GROUPS: { labelKey: 'auditGroupProducts' | 'auditGroupOrders' | 'auditGroupAnnouncement' | 'auditGroupCustomers' | 'auditGroupSettings'; actions: AuditAction[] }[] = [
  {
    labelKey: 'auditGroupProducts',
    actions: [
      'product.create',
      'product.update',
      'product.delete',
      'product.translate',
      'variant.create',
      'variant.update',
      'variant.delete',
      'stock.add',
      'stock.delete',
    ],
  },
  { labelKey: 'auditGroupOrders', actions: ['order.redeliver', 'order.cancel'] },
  {
    labelKey: 'auditGroupAnnouncement',
    actions: ['announcement.update', 'announcement.translate'],
  },
  {
    labelKey: 'auditGroupCustomers',
    actions: ['customer.lock', 'customer.unlock', 'admin.grant', 'admin.revoke'],
  },
  { labelKey: 'auditGroupSettings', actions: ['settings.update'] },
];

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function formatChangeValue(value: unknown, t: Dictionary): string {
  if (value === null || value === undefined || value === '') return t.common.dash;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Chi tiết một dòng nhật ký: name/code, "field: from → to", fallback entityId. */
function AuditDetails({ log, t }: { log: AuditLogDto; t: Dictionary }) {
  const details = log.details;
  const lines: ReactNode[] = [];

  if (details) {
    const name = typeof details.name === 'string' ? details.name : '';
    const productName = typeof details.productName === 'string' ? details.productName : '';
    const variantName = typeof details.variantName === 'string' ? details.variantName : '';
    const code = typeof details.code === 'string' ? details.code : '';
    const added = typeof details.added === 'number' ? details.added : null;

    if (name) {
      lines.push(
        <span key="name" className="block truncate text-neutral-950">
          {name}
        </span>,
      );
    }
    if (productName) {
      lines.push(
        <span key="product" className="block truncate text-neutral-950">
          {variantName ? t.admin.productVariantLabel(productName, variantName) : productName}
        </span>,
      );
    }
    if (code) {
      lines.push(
        <span key="code" className="block font-mono text-[13px] text-neutral-950">
          {code}
        </span>,
      );
    }
    if (added !== null) {
      lines.push(
        <span key="added" className="block text-neutral-500">
          {t.admin.auditAddedLines(added)}
        </span>,
      );
    }

    const changes = details.changes;
    if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
      for (const [field, change] of Object.entries(changes as Record<string, unknown>)) {
        const pair =
          change && typeof change === 'object' && !Array.isArray(change)
            ? (change as { from?: unknown; to?: unknown })
            : null;
        lines.push(
          <span key={`change-${field}`} className="block text-neutral-500">
            <span className="font-medium text-neutral-700">{field}</span>
            {': '}
            {formatChangeValue(pair?.from, t)}
            {' → '}
            {formatChangeValue(pair?.to, t)}
          </span>,
        );
      }
    }
  }

  if (lines.length === 0) {
    if (log.entityId) {
      return <span className="font-mono text-xs text-neutral-400">{log.entityId}</span>;
    }
    return <span className="text-neutral-400">{t.common.dash}</span>;
  }

  return <div className="space-y-0.5">{lines}</div>;
}

export default function AdminAuditPage() {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [action, setAction] = useState<ActionFilter>('ALL');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<Paginated<AuditLogDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const search = new URLSearchParams();
    if (action !== 'ALL') search.set('action', action);
    search.set('page', String(page));
    search.set('limit', String(PAGE_SIZE));

    apiFetch<Paginated<AuditLogDto>>(`/admin/audit?${search.toString()}`, { token })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (active) setError(apiErrorMessage(err, t.common.connectionError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [action, page, token, t]);

  const handleFilterChange = (value: string) => {
    // Chỉ nhận giá trị hợp lệ trong danh sách AUDIT_ACTIONS.
    setAction(value !== 'ALL' && isAuditAction(value) ? value : 'ALL');
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t.admin.auditTitle} description={t.admin.auditSubtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={action}
          onChange={(event) => handleFilterChange(event.target.value)}
          aria-label={t.admin.auditFilterAria}
          className={`${SELECT_CLASSES} w-full sm:w-72`}
        >
          <option value="ALL">{t.admin.auditFilterAll}</option>
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group.labelKey} label={t.admin[group.labelKey]}>
              {group.actions.map((value) => (
                <option key={value} value={value}>
                  {t.admin.auditActions[value]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error ? (
        <EmptyState
          icon={ServerCrash}
          title={t.admin.auditError}
          hint={error}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      ) : data === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t.admin.auditEmptyTitle}
          hint={action !== 'ALL' ? t.admin.auditEmptyHintFilter : t.admin.auditEmptyHint}
        />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table
              className={
                loading ? 'w-full min-w-[820px] text-sm opacity-60' : 'w-full min-w-[820px] text-sm'
              }
            >
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500">
                  <th className="px-4 py-3 font-medium">{t.admin.colTime}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colActor}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colAction}</th>
                  <th className="px-4 py-3 font-medium">{t.admin.colDetails}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {data.items.map((log) => (
                  <tr key={log.id} className="align-top transition-colors hover:bg-neutral-50">
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <span className="block truncate text-neutral-950">{log.actorEmail}</span>
                      <span className="block font-mono text-xs tabular-nums text-neutral-400">
                        {formatUserCode(log.actorCode)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant="outline">{t.admin.auditActions[log.action]}</Badge>
                    </td>
                    <td className="max-w-[320px] px-4 py-3">
                      <AuditDetails log={log} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination
            className="mt-4"
            page={page}
            total={data.total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </>
  );
}
