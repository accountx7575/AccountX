import { useEffect, useMemo, useState } from 'react';
import { useAuditLogs, type AuditLog } from '@/hooks/useAuditLogs';
import { useAuth } from '@/context/AuthContext';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { ListPagination } from '@/components/ui/ListControls';
import { Input } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScrollText, Search } from 'lucide-react';

const PAGE_SIZES = [10, 25, 50];

function metaSummary(meta: Record<string, unknown> | null): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  const s = JSON.stringify(meta);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export function AuditLogPanel() {
  const { activeBusiness } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [actionInput, setActionInput] = useState('');
  const [userInput, setUserInput] = useState('');
  const [actionQuery, setActionQuery] = useState('');
  const [userQuery, setUserQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setActionQuery(actionInput.trim());
      setUserQuery(userInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [actionInput, userInput]);

  const { rows, total, loading, error, refresh } = useAuditLogs({ businessId: activeBusiness?.id, page, pageSize, actionQuery, userQuery });

  const columns = useMemo<DataTableColumn<AuditLog>[]>(() => [
    {
      key: 'when',
      label: 'When',
      render: (r) => (
        <span className="figure text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">
          {r.created_at.slice(0, 16).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'actor',
      label: 'Actor',
      render: (r) => (
        <span className="text-sm truncate block max-w-[16rem]" title={r.actor_email}>
          {r.actor_email || r.actor?.slice(0, 8) || 'system'}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      render: (r) => (
        <code className="inline-block rounded-md bg-secondary-100 dark:bg-secondary-800 px-2 py-0.5 text-xs font-medium text-secondary-700 dark:text-zinc-200">
          {r.action}
        </code>
      ),
    },
    {
      key: 'entity',
      label: 'Entity',
      render: (r) => (
        <span className="text-xs text-secondary-500 dark:text-secondary-400">
          {r.entity_type}
          <span className="figure text-secondary-300 dark:text-secondary-600 ml-1.5">{r.entity_id.slice(0, 8)}</span>
        </span>
      ),
    },
    {
      key: 'meta',
      label: 'Details',
      render: (r) => {
        const s = metaSummary(r.meta);
        if (!s) return <span className="text-xs text-secondary-300 dark:text-secondary-600">—</span>;
        return (
          <span className="block max-w-[18rem] truncate text-xs font-mono text-secondary-500 dark:text-secondary-400" title={s}>
            {s}
          </span>
        );
      },
    },
    {
      key: 'source',
      label: 'Source',
      render: (r) => (
        <span className="figure text-xs text-secondary-400 whitespace-nowrap">
          {[r.ip, r.device].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
  ], []);

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="rounded-lg bg-secondary-100 dark:bg-secondary-800 p-2.5">
          <ScrollText className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Activity Log</h3>
          <p className="text-xs text-secondary-500 dark:text-secondary-400">Every privileged action on this business, newest first</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-secondary-200 dark:border-secondary-800">
        <div className="relative max-w-[12rem] flex-1 min-w-[9rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" aria-hidden="true" />
          <Input
            placeholder="Filter by action…"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            className="pl-10"
            aria-label="Filter audit log by action"
          />
        </div>
        <Input
          placeholder="Actor email…"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          className="max-w-[14rem]"
          aria-label="Filter audit log by actor email"
        />
        <label className="flex items-center gap-2 text-xs text-secondary-500 dark:text-secondary-400 ml-auto">
          Rows
          <select
            className="input w-auto py-1.5 text-xs"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => String(r.id)}
            loading={loading}
            stickyHeader
            emptyState={
              <div className="px-4 py-10 text-center text-sm text-secondary-400">
                No activity matches these filters.
              </div>
            }
          />
          <ListPagination page={page} onPageChange={setPage} pageSize={pageSize} from={(page - 1) * pageSize} total={total} isLoading={loading} />
        </>
      )}
    </section>
  );
}
