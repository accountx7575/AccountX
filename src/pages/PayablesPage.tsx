import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Truck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Drawer } from '@/components/ui/Drawer';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DatePicker } from '@/components/common/DatePicker';
import { usePagedList } from '@/hooks/usePagedList';
import { formatCurrency, formatDate } from '@/lib/utils';
import { downloadLedgerCsv } from '@/lib/exportLedger';
import { can, capabilityTooltip } from '@/lib/rbac';

type AgingDocRow = {
  party_id: string;
  party_name: string | null;
  doc_id: string;
  doc_number: string;
  doc_date: string;
  due_date: string;
  outstanding: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
};

type StatementRow = {
  entry_date: string;
  doc_type: string;
  doc_number: string | null;
  description: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
};

type PartyAging = {
  partyId: string;
  name: string;
  total: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  docs: AgingDocRow[];
};

const money = (n: number | null | undefined) => (n ? Math.round(n * 100) / 100 : 0);

export function PayablesPage() {
  const { activeBusiness, activeRole } = useAuth();
  const list = usePagedList();
  const [selected, setSelected] = useState<PartyAging | null>(null);
  const [stmtFrom, setStmtFrom] = useState('');
  const [stmtTo, setStmtTo] = useState('');

  const aging = useQuery({
    queryKey: ['payables-aging', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as AgingDocRow[];
      const { data, error } = await supabase.rpc('get_payables_aging', { p_business_id: activeBusiness.id });
      if (error) throw new Error(error.message);
      return (data || []) as AgingDocRow[];
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const parties = useMemo<PartyAging[]>(() => {
    const byParty = new Map<string, PartyAging>();
    for (const d of aging.data || []) {
      let p = byParty.get(d.party_id);
      if (!p) {
        p = { partyId: d.party_id, name: d.party_name || 'Unnamed supplier', total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, docs: [] };
        byParty.set(d.party_id, p);
      }
      p.total += money(d.outstanding);
      p.current += money(d.current);
      p.d1_30 += money(d.days_1_30);
      p.d31_60 += money(d.days_31_60);
      p.d61_90 += money(d.days_61_90);
      p.d90plus += money(d.days_90_plus);
      p.docs.push(d);
    }
    return [...byParty.values()].sort((a, b) => b.total - a.total);
  }, [aging.data]);

  const filtered = useMemo(() => {
    const q = list.debouncedSearch.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.docs.some((d) => d.doc_number.toLowerCase().includes(q))
    );
  }, [parties, list.debouncedSearch]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);
  const totals = useMemo(
    () =>
      filtered.reduce(
        (t, p) => ({ total: t.total + p.total, overdue: t.overdue + p.d1_30 + p.d31_60 + p.d61_90 + p.d90plus }),
        { total: 0, overdue: 0 }
      ),
    [filtered]
  );

  const statement = useQuery({
    queryKey: ['supplier-statement', activeBusiness?.id, selected?.partyId, stmtFrom, stmtTo],
    queryFn: async () => {
      if (!activeBusiness || !selected) return [] as StatementRow[];
      const { data, error } = await supabase.rpc('get_supplier_statement', {
        p_business_id: activeBusiness.id,
        p_supplier_id: selected.partyId,
        p_from_date: stmtFrom || null,
        p_to_date: stmtTo || null,
      });
      if (error) throw new Error(error.message);
      return (data || []) as StatementRow[];
    },
    enabled: !!activeBusiness && !!selected,
    placeholderData: (prev) => prev,
  });

  const openStatement = (p: PartyAging) => {
    setSelected(p);
    setStmtFrom('');
    setStmtTo('');
  };

  const exportCsv = () => {
    const rows = (aging.data || []).map((d) => ({
      Supplier: d.party_name || '',
      'Bill No': d.doc_number,
      'Bill Date': d.doc_date,
      'Due Date': d.due_date,
      Outstanding: money(d.outstanding),
      Current: money(d.current),
      'Days 1-30': money(d.days_1_30),
      'Days 31-60': money(d.days_31_60),
      'Days 61-90': money(d.days_61_90),
      'Days 90+': money(d.days_90_plus),
    }));
    downloadLedgerCsv(`payables-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  const closingBalance = statement.data && statement.data.length > 0
    ? statement.data[statement.data.length - 1].running_balance
    : null;

  return (
    <div>
      <PageHeader
        title="Payables"
        subtitle={`${filtered.length} supplier${filtered.length !== 1 ? 's' : ''} with outstanding bills`}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!can(activeRole, 'data.export') || (aging.data || []).length === 0}
            title={capabilityTooltip('data.export', activeRole)}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Total Payable</p>
          <p className="text-2xl font-semibold text-secondary-900 dark:text-white mt-1 tabular-nums figure">
            {formatCurrency(Math.round(totals.total * 100) / 100, activeBusiness?.currency_symbol)}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Overdue</p>
          <p className="text-2xl font-semibold text-error-600 dark:text-error-400 mt-1 tabular-nums figure">
            {formatCurrency(Math.round(totals.overdue * 100) / 100, activeBusiness?.currency_symbol)}
          </p>
        </div>
      </div>

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search suppliers or bill numbers..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {aging.isError ? (
          <ErrorState title="Unable to load payables ageing summary." onRetry={() => aging.refetch()} />
        ) : aging.isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : pageRows.length === 0 ? (
          <EmptyState icon={Truck} title="No outstanding payables"
            description={list.search ? 'No supplier matches your search.' : 'Every confirmed bill is fully paid — nothing owed.'} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Current</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">1&ndash;30</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">31&ndash;60</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">61&ndash;90</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">90+</th>
                  <th className="text-right px-4 py-3 font-medium">Statement</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.partyId} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{p.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold figure">{formatCurrency(p.total, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden md:table-cell text-secondary-500">{p.current ? formatCurrency(p.current, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-secondary-500">{p.d1_30 ? formatCurrency(p.d1_30, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-warning-600 dark:text-warning-400">{p.d31_60 ? formatCurrency(p.d31_60, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-warning-600 dark:text-warning-400">{p.d61_90 ? formatCurrency(p.d61_90, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure hidden lg:table-cell text-error-600 dark:text-error-400">{p.d90plus ? formatCurrency(p.d90plus, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => openStatement(p)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ListPagination
          page={list.page}
          onPageChange={list.setPage}
          pageSize={list.pageSize}
          from={list.from}
          total={filtered.length}
          isLoading={aging.isLoading}
        />
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} width="xl" title={`Supplier statement — ${selected?.name ?? ''}`}>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">From</label>
            <DatePicker value={stmtFrom || undefined} onChange={(iso) => setStmtFrom(iso)} clearable placeholder="All time" />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">To</label>
            <DatePicker value={stmtTo || undefined} onChange={(iso) => setStmtTo(iso)} clearable placeholder="Today" max={stmtTo || undefined} />
          </div>
          <p className="text-xs text-secondary-400 ml-auto">Positive balance means you owe the supplier.</p>
        </div>

        {statement.isError ? (
          <ErrorState title="Unable to load supplier statement." onRetry={() => statement.refetch()} />
        ) : statement.isLoading ? (
          <div className="space-y-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : !statement.data || statement.data.length === 0 ? (
          <EmptyState icon={FileText} title="No statement entries" description="No transactions found for this supplier in the selected period." />
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-thin border border-secondary-200 dark:border-secondary-800 rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400 bg-secondary-50/60 dark:bg-secondary-800/40">
                    <th className="text-left px-3 py-2.5 font-medium">Date</th>
                    <th className="text-left px-3 py-2.5 font-medium">Type</th>
                    <th className="text-left px-3 py-2.5 font-medium">Doc No.</th>
                    <th className="text-left px-3 py-2.5 font-medium">Description</th>
                    <th className="text-right px-3 py-2.5 font-medium">Debit</th>
                    <th className="text-right px-3 py-2.5 font-medium">Credit</th>
                    <th className="text-right px-3 py-2.5 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.data.map((r, i) => (
                    <tr key={i} className={r.doc_type === 'bf' ? 'border-b border-secondary-100 dark:border-secondary-800/50 bg-secondary-50/40 dark:bg-secondary-800/20' : 'border-b border-secondary-100 dark:border-secondary-800/50'}>
                      <td className="px-3 py-2 whitespace-nowrap text-secondary-500">{r.doc_type === 'bf' ? '—' : formatDate(r.entry_date)}</td>
                      <td className="px-3 py-2 text-secondary-500">{r.description === 'Brought forward' ? 'Brought forward' : r.description}</td>
                      <td className="px-3 py-2 font-medium text-secondary-500">{r.doc_number || '—'}</td>
                      <td className="px-3 py-2 text-secondary-600 dark:text-secondary-300">{r.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure">{r.debit_amount ? formatCurrency(r.debit_amount, activeBusiness?.currency_symbol) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure">{r.credit_amount ? formatCurrency(r.credit_amount, activeBusiness?.currency_symbol) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums figure font-medium">{formatCurrency(r.running_balance, activeBusiness?.currency_symbol)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <span className="badge bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                Closing balance: {formatCurrency(closingBalance ?? 0, activeBusiness?.currency_symbol)}
              </span>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
