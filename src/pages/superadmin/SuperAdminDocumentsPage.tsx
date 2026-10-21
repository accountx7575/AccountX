import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  assembleDocs, fetchDocItems, fetchOverview, type SuperAdminDocRow, type SuperAdminItemRow,
  type SuperAdminOverview,
} from '@/lib/superAdminData';

function dateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function inr(n: number): string {
  try {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  } catch {
    return `₹${n}`;
  }
}

export function InvoicesPage() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [docs, setDocs] = useState<SuperAdminDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [bizFilter, setBizFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  const [inspect, setInspect] = useState<SuperAdminDocRow | null>(null);
  const [items, setItems] = useState<SuperAdminItemRow[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ov = await fetchOverview();
        setOverview(ov);
        setDocs(assembleDocs(ov));
      } catch (err) {
        console.error('super-admin invoices load failed:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!inspect) return;
    setItems(null);
    setItemsLoading(true);
    fetchDocItems(inspect.type, inspect.id)
      .then((rows) => setItems(rows))
      .catch(() => setItems([]))
      .finally(() => setItemsLoading(false));
  }, [inspect]);

  const bizName = (id: string) =>
    overview?.businesses.find((b) => String(b.id) === id)?.name ||
    overview?.businesses.find((b) => String(b.id) === id)?.legal_name ||
    'Unknown Business';

  const custId = (id: string | null) => (id ? String(id) : '—');

  const filtered = docs.filter((d) => {
    if (bizFilter !== 'all' && String(d.businessId) !== bizFilter) return false;
    if (typeFilter !== 'all' && d.type !== typeFilter) return false;
    if (fromDate && (d.date || '') < fromDate) return false;
    if (toDate && (d.date || '') > toDate) return false;
    const q = search.toLowerCase().trim();
    if (q && !`${d.number} ${d.status} ${custId(d.customerId)}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-secondary-900 dark:text-white">Global Documents</h1>
        <p className="text-sm text-secondary-500 dark:text-secondary-400">
          Read-only cross-tenant invoice, quotation & e-way viewer
        </p>
      </div>

      <div className="card-solid p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="input text-sm">
          <option value="all">All businesses</option>
          {(overview?.businesses || []).map((b) => (
            <option key={String(b.id)} value={String(b.id)}>{b.name || b.legal_name || String(b.id).slice(0, 8)}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="input text-sm">
          <option value="all">All document types</option>
          <option value="Invoice">Invoices</option>
          <option value="Quotation">Quotations</option>
          <option value="E-Way Bill">E-Way Bills</option>
        </select>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <Input placeholder="Search number / status…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card-solid overflow-hidden">
        <table className="w-full text-left text-sm min-w-[820px]">
          <thead className="bg-secondary-50 dark:bg-secondary-800/50 border-b border-secondary-200 dark:border-secondary-800 text-xs font-semibold text-secondary-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-secondary-400">Loading cross-tenant documents…</td></tr>
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-secondary-500">Could not load documents (RLS may be blocking cross-tenant reads).</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => toast('Retry kicked off', 'info')}>Retry</Button>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-secondary-400">No documents match the current filters.</td></tr>
            ) : (
              filtered.slice(0, 300).map((d) => (
                <tr key={`${d.type}-${d.id}`} className="table-row-hover">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-secondary-900 dark:text-white">{d.number}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium border border-secondary-200 dark:border-secondary-700 bg-secondary-100 dark:bg-secondary-800 text-secondary-700 dark:text-secondary-200">{d.type}</span>
                  </td>
                  <td className="px-4 py-3 text-secondary-600 dark:text-secondary-300">{bizName(String(d.businessId))}</td>
                  <td className="px-4 py-3 text-xs text-secondary-500 whitespace-nowrap">{d.date || '—'}</td>
                  <td className="px-4 py-3 figure">{inr(d.total)}</td>
                  <td className="px-4 py-3 text-xs capitalize">{d.status.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="secondary" size="sm" className="text-xs" onClick={() => setInspect(d)}>Inspect</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && filtered.length > 300 && (
          <p className="px-4 py-2 text-xs text-secondary-400 border-t border-secondary-100 dark:border-secondary-800">
            Showing newest 300 of {filtered.length} documents — refine filters to narrow.
          </p>
        )}
      </div>

      {inspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setInspect(null)}>
          <div className="card-solid w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-secondary-200 dark:border-secondary-800">
              <div>
                <p className="text-sm font-bold text-secondary-900 dark:text-white font-mono">{inspect.number}</p>
                <p className="text-xs text-secondary-400">{inspect.type} · {bizName(String(inspect.businessId))} · {inspect.date}</p>
              </div>
              <button onClick={() => setInspect(null)} className="text-secondary-400 hover:text-secondary-600 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {itemsLoading ? (
                <p className="text-sm text-secondary-400 py-6 text-center">Fetching document items…</p>
              ) : inspect.type === 'E-Way Bill' ? (
                <p className="text-xs text-secondary-400">E-way bill memo — view its source invoice for line items.</p>
              ) : items && items.length > 0 ? (
                <table className="w-full text-left text-sm">
                  <thead className="text-xs font-semibold text-secondary-500 uppercase">
                    <tr><th className="py-2">Item</th><th className="py-2">Qty</th><th className="py-2">Rate</th><th className="py-2 text-right">Amount</th></tr>
                  </thead>
                  <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800">
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-2 text-secondary-800 dark:text-secondary-200">{it.name}</td>
                        <td className="py-2 text-secondary-500">{it.quantity} {it.unit}</td>
                        <td className="py-2 text-secondary-500">{inr(it.rate)}</td>
                        <td className="py-2 text-right figure">{inr(it.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-secondary-400">No line items found for this document.</p>
              )}
              <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                <div><p className="text-secondary-400 uppercase font-semibold">Status</p><p className="capitalize text-secondary-700 dark:text-secondary-200">{inspect.status.replace(/_/g, ' ')}</p></div>
                <div><p className="text-secondary-400 uppercase font-semibold">Customer ID</p><p className="font-mono text-secondary-700 dark:text-secondary-200 break-all">{custId(inspect.customerId)}</p></div>
              </div>
              <p className="text-[11px] text-secondary-400">Inspector opened {dateTime(new Date().toISOString())} · read-only, no tenant writes performed.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
