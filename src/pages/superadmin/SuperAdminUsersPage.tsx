import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  assembleUsers, fetchOverview, type SuperAdminOverview, type SuperAdminUserRow,
} from '@/lib/superAdminData';
import { planTypeLabel } from '@/lib/planTypes';

function inr(n: number): string {
  try {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    return `₹${n}`;
  }
}

export function UsersPage() {
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Blocked'>('All');
  const [summaryUser, setSummaryUser] = useState<SuperAdminUserRow | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setOverview(await fetchOverview());
      } catch (err) {
        console.error('super-admin users load failed:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rows = useMemo(() => (overview ? assembleUsers(overview) : []), [overview]);

  const bizById = (id: string | null | undefined) =>
    overview?.businesses.find((b) => String(b.id) === String(id)) ?? null;

  const filtered = rows.filter((u) => {
    if (statusFilter === 'Active' && !u.isActive) return false;
    if (statusFilter === 'Blocked' && u.isActive) return false;
    const q = search.toLowerCase().trim();
    if (q && !`${u.name} ${u.email} ${u.phone} ${u.businessName} ${u.gstin}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-secondary-900 dark:text-white">Users & Tenants</h1>
        <p className="text-sm text-secondary-500 dark:text-secondary-400">
          Every membership joined to its business record
        </p>
      </div>

      <div className="card-solid p-4 flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1 min-w-0">
          <Input
            placeholder="Search name, email, phone, business, GSTIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'All' | 'Active' | 'Blocked')} className="input text-sm">
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Blocked">Blocked</option>
        </select>
        <span className="text-xs text-secondary-400 whitespace-nowrap">{filtered.length} memberships</span>
      </div>

      <div className="card-solid overflow-hidden">
        <table className="w-full text-left text-sm min-w-[900px]">
          <thead className="bg-secondary-50 dark:bg-secondary-800/50 border-b border-secondary-200 dark:border-secondary-800 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">GSTIN</th>
              <th className="px-4 py-3">Reg. date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Docs</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-secondary-400">Loading memberships…</td></tr>
            ) : error ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-secondary-400">Could not load users (RLS may be blocking cross-tenant reads).</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-secondary-400">No users match the current filters.</td></tr>
            ) : (
              filtered.slice(0, 200).map((u) => (
                <tr key={u.memberId} className="bg-secondary-100/60 dark:bg-secondary-800/50 table-row-hover">
                  <td className="px-4 py-3 font-semibold text-secondary-900 dark:text-white">{u.name}</td>
                  <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300 font-mono text-xs">{u.email}</td>
                  <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300 text-xs">{u.phone}</td>
                  <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300">{u.businessName}</td>
                  <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300 font-mono text-xs">{u.gstin}</td>
                  <td className="px-4 py-3 text-secondary-500 text-xs whitespace-nowrap">{u.regDate || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${
                      u.isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400'
                    }`}>{u.isActive ? 'Active' : 'Blocked'}</span>
                  </td>
                  <td className="px-4 py-3 text-secondary-700 dark:text-secondary-200">{u.docCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" size="sm" className="text-xs" onClick={() => setSummaryUser(u)}>View business summary</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && filtered.length > 200 && (
          <p className="px-4 py-2 text-xs text-secondary-400 border-t border-secondary-100 dark:border-secondary-800">
            Showing first 200 of {filtered.length} memberships — search to narrow.
          </p>
        )}
      </div>

      {summaryUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSummaryUser(null)}>
          <div className="card-solid w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-secondary-200 dark:border-secondary-800">
              <div>
                <p className="text-sm font-bold text-secondary-900 dark:text-white">{summaryUser?.businessId ? (bizById(summaryUser.businessId) as any)?.name || 'Business' : 'Business'}</p>
                <p className="text-xs text-secondary-400">Business summary · {summaryUser.role}</p>
              </div>
              <button onClick={() => setSummaryUser(null)} className="text-secondary-400 hover:text-secondary-600 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {[
                ['Legal name', (bizById(summaryUser?.businessId) as any)?.legal_name || '—'],
                ['GSTIN', (bizById(summaryUser?.businessId) as any)?.gstin || '—'],
                ['State', (bizById(summaryUser?.businessId) as any)?.state || '—'],
                ['Plan', planTypeLabel((bizById(summaryUser?.businessId) as any)?.plan_type) || '—'],
                ['Currency', (bizById(summaryUser?.businessId) as any)?.currency || '—'],
                ['Registered', summaryUser.regDate || '—'],
                ['Contact email', summaryUser.email],
                ['Phone', summaryUser.phone],
                ['Active', summaryUser.isActive ? 'Yes' : 'No'],
                ['Documents', String(summaryUser.docCount)],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-secondary-400 uppercase font-semibold tracking-wide">{k}</p>
                  <p className="text-secondary-800 dark:text-secondary-200 mt-0.5 break-words">{v}</p>
                </div>
              ))}
            </div>
            <p className="px-5 pb-4 text-[11px] text-secondary-400">Read-only summary — no tenant writes performed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
