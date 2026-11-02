import { useState } from 'react';
import { Clock, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { auditSeverity, useAuditTrail, type AuditSeverity } from '@/hooks/useAdminTelemetry';

const PAGE_SIZE = 10;

function severityBadge(sev: AuditSeverity): string {
  if (sev === 'critical')
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900';
  if (sev === 'warning')
    return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900';
  return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900';
}

export function AuditTrailTable() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<'all' | AuditSeverity>('all');
  const { rows, total, loading, error } = useAuditTrail({
    page,
    pageSize: PAGE_SIZE,
    search,
    severity,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-slate-200 dark:border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Audit Trail</h3>
        <span className="ml-auto text-xs text-slate-400">{total} events</span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search actor email or action…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <select
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value as 'all' | AuditSeverity);
            setPage(0);
          }}
          aria-label="Filter by severity"
          className="px-3 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-slate-700 dark:text-zinc-200"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading audit events…</p>
      ) : error ? (
        <p className="text-sm text-rose-600 py-6 text-center">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No audit events yet.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {rows.map((r) => {
            const sev = auditSeverity(r.action);
            return (
              <li key={r.id} className="flex gap-3 items-start">
                <span
                  className={`mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${severityBadge(sev)}`}
                >
                  {sev}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800 dark:text-zinc-200 font-medium break-words">
                    {r.action}
                  </p>
                  <p className="text-xs text-slate-400 break-words">
                    {r.actor_email}
                    {r.target_business_id ? ` · ${r.target_business_id.slice(0, 8)}…` : ''}
                    {' · '}
                    {new Date(r.created_at).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-slate-400">
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
