import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  assembleUsers, assembleDocs, computeMetrics, computeSignups, fetchOverview,
  type SuperAdminOverview,
} from '@/lib/superAdminData';

function inr(n: number): string {
  try {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    return `₹${n}`;
  }
}

export function DashboardPage() {
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchOverview()
      .then(setOverview)
      .catch((err) => {
        console.error('super-admin dashboard load failed:', err);
        setError(true);
      });
  }, []);

  const metrics = useMemo(() => (overview ? computeMetrics(overview) : null), [overview]);
  const signups = useMemo(() => (overview ? computeSignups(overview.members) : []), [overview]);
  const userRows = useMemo(() => (overview ? assembleUsers(overview).slice(0, 8) : []), [overview]);
  const docs = useMemo(() => (overview ? assembleDocs(overview).slice(0, 8) : []), [overview]);

  const maxSignups = Math.max(1, ...signups.map((s) => s.count));

  const cards = metrics ? [
    { label: 'Total Users', value: String(metrics.totalUsers), hint: `${userRows ? overview!.members.length : 0} memberships`, tone: 'text-blue-600 dark:text-blue-400' },
    { label: 'Active Businesses', value: String(metrics.activeBusinesses), hint: `of ${metrics.totalBusinesses} total`, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Documents Created', value: String(metrics.totalDocs), hint: 'invoices + quotations + e-way', tone: 'text-purple-600 dark:text-purple-400' },
    { label: 'Platform Invoiced Volume', value: inr(metrics.gmv), hint: 'GMV across tenants', tone: 'text-amber-600 dark:text-amber-400' },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-secondary-900 dark:text-white">Platform Dashboard</h1>
        <p className="text-sm text-secondary-500 dark:text-secondary-400">Cross-tenant health overview (read-only)</p>
      </div>

      {error && (
        <div className="card-solid p-4 text-sm text-rose-600">
          Metrics could not load — RLS may be blocking cross-tenant reads. Check the humanQA notes.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics ? cards.map((c) => (
          <div key={c.label} className="card-solid p-5">
            <span className="text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400">{c.label}</span>
            <div className={`text-2xl font-bold mt-3 ${c.tone}`}>{c.value}</div>
            <p className="text-xs text-secondary-400 mt-1">{c.hint}</p>
          </div>
        )) : [0, 1, 2, 3].map((i) => (
          <div key={i} className="card-solid p-5 animate-pulse">
            <div className="h-3 w-24 bg-secondary-100 dark:bg-secondary-800 rounded" />
            <div className="h-6 w-16 bg-secondary-100 dark:bg-secondary-800 rounded mt-3" />
          </div>
        ))}
      </div>

      {metrics && (
        <>
          <div className="card-solid p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">New signups — last 7 days</h2>
              <Badge variant="primary">{signups.reduce((a, b) => a + b.count, 0)} this week</Badge>
            </div>
            <div className="flex items-end gap-2 h-28">
              {signups.map((s) => (
                <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-secondary-400">{s.count || ''}</span>
                  <div
                    className="w-full rounded-t bg-primary-500/80 dark:bg-primary-500/60 transition-all"
                    style={{ height: `${Math.max(3, (s.count / maxSignups) * 90)}px` }}
                    title={`${s.count} signups on ${s.label}`}
                  />
                  <span className="text-[10px] text-secondary-400">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card-solid overflow-hidden">
              <div className="px-5 py-4 border-b border-secondary-200 dark:border-secondary-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">Recent signups</h2>
                <Link to="/super-admin/users" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">View all</Link>
              </div>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                  {userRows.length === 0 ? (
                    <tr><td className="px-5 py-6 text-center text-secondary-400 text-sm">No member records yet.</td></tr>
                  ) : userRows.map((u) => (
                    <tr key={u.memberId} className="table-row-hover">
                      <td className="px-5 py-3">
                        <div className="font-medium text-secondary-900 dark:text-white">{u.name}</div>
                        <div className="text-xs text-secondary-400">{u.businessName} · {u.role}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-secondary-500 whitespace-nowrap">{u.regDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-solid overflow-hidden">
              <div className="px-5 py-4 border-b border-secondary-200 dark:border-secondary-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-secondary-900 dark:text-white">Recent documents</h2>
                <Link to="/super-admin/documents" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Viewer</Link>
              </div>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                  {docs.length === 0 ? (
                    <tr><td className="px-5 py-6 text-center text-secondary-400 text-sm">No documents yet.</td></tr>
                  ) : docs.map((d) => (
                    <tr key={`${d.type}-${d.id}`} className="table-row-hover">
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs font-semibold text-secondary-900 dark:text-white">{d.number}</div>
                        <div className="text-xs text-secondary-400">{d.type}</div>
                      </td>
                      <td className="px-5 py-3 text-xs text-secondary-500 whitespace-nowrap">{d.date}</td>
                      <td className="px-5 py-3 figure text-xs">{inr(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {metrics && (
        <p className="text-xs text-secondary-400">
          Counts are client-side aggregates over existing tables (latest {signups.length ? '5,000' : '—'} rows / type) — server-side rollups arrive with a dedicated migration (humanQA).
        </p>
      )}
    </div>
  );
}
