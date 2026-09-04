import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Banknote, Download } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DatePicker } from '@/components/common/DatePicker';
import { TransferFundsModal } from '@/components/cashbank/TransferFundsModal';
import { usePagedList } from '@/hooks/usePagedList';
import { fetchCashBankMovements, resolvePreset, type DateRange } from '@/lib/reportsAdapter';
import { formatCurrency } from '@/lib/utils';
import { downloadLedgerCsv } from '@/lib/exportLedger';
import { can, capabilityTooltip } from '@/lib/rbac';

export function CashBankPage() {
  const { activeBusiness, activeRole } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = usePagedList();
  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));
  const [transferOpen, setTransferOpen] = useState(false);

  // Accounts for the transfer pickers (Cash & Bank group only, with uuids).
  const accountsQuery = useQuery({
    queryKey: ['cash-bank-accounts', activeBusiness?.id],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, current_balance')
        .eq('business_id', activeBusiness!.id)
        .eq('group_name', 'Cash & Bank')
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as { id: string; name: string; current_balance: number }[];
    },
    enabled: !!activeBusiness,
  });

  const report = useQuery({
    queryKey: ['cash-bank-movements', activeBusiness?.id, range.from, range.to],
    queryFn: () => {
      if (!activeBusiness) throw new Error('No active business');
      return fetchCashBankMovements({ businessId: activeBusiness.id, range });
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const rows = report.data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = list.debouncedSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.ledger_name.toLowerCase().includes(q));
  }, [rows, list.debouncedSearch]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);
  const totals = report.data?.totals ?? { opening: 0, inflow: 0, outflow: 0, closing: 0 };

  const exportCsv = () => {
    downloadLedgerCsv(
      `cash-bank-${range.from}-to-${range.to}.csv`,
      rows.map((r) => ({
        Ledger: r.ledger_name,
        Opening: r.opening,
        Inflow: r.inflow,
        Outflow: r.outflow,
        Net: r.net,
        Closing: r.closing,
      }))
    );
  };

  return (
    <div>
      <PageHeader
        title="Cash & Bank"
        subtitle="Ledger-truth movements on cash and bank accounts"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setTransferOpen(true)}
              disabled={(accountsQuery.data?.length ?? 0) < 2}
              title={(accountsQuery.data?.length ?? 0) < 2 ? 'A transfer needs at least two Cash & Bank accounts' : 'Move funds between cash and bank accounts'}
            >
              <ArrowLeftRight className="h-4 w-4" /> Transfer
            </Button>
            <Button variant="secondary" onClick={exportCsv} disabled={!can(activeRole, 'data.export') || rows.length === 0}
              title={capabilityTooltip('data.export', activeRole)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </>
        }
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">From</label>
          <DatePicker value={range.from} onChange={(iso) => setRange((r) => ({ ...r, from: iso }))} max={range.to} />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-500 dark:text-secondary-400 mb-1">To</label>
          <DatePicker value={range.to} onChange={(iso) => setRange((r) => ({ ...r, to: iso }))} min={range.from} />
        </div>
        <p className="text-xs text-secondary-400 ml-auto max-w-md">
          Built from posted journal lines on accounts in the Cash &amp; Bank group — opening balances come from earlier entries, so figures reconcile with the books.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Opening</p>
          <p className="text-xl font-semibold text-secondary-900 dark:text-white mt-1 tabular-nums figure">{formatCurrency(totals.opening, activeBusiness?.currency_symbol)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Inflow</p>
          <p className="text-xl font-semibold text-success-600 dark:text-success-400 mt-1 tabular-nums figure">{formatCurrency(totals.inflow, activeBusiness?.currency_symbol)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Outflow</p>
          <p className="text-xl font-semibold text-error-600 dark:text-error-400 mt-1 tabular-nums figure">{formatCurrency(totals.outflow, activeBusiness?.currency_symbol)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-secondary-400 font-medium">Closing</p>
          <p className="text-xl font-semibold text-secondary-900 dark:text-white mt-1 tabular-nums figure">{formatCurrency(totals.closing, activeBusiness?.currency_symbol)}</p>
        </div>
      </div>

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search ledgers..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {report.isError ? (
          <ErrorState title="Unable to load cash & bank accounts." onRetry={() => report.refetch()} />
        ) : report.isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : pageRows.length === 0 ? (
          <EmptyState icon={Banknote} title="No cash or bank activity"
            description={list.search ? 'No ledger matches your search.' : 'Posted journal lines touching cash/bank ledgers in this period will appear here.'} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Ledger</th>
                  <th className="text-right px-4 py-3 font-medium">Opening</th>
                  <th className="text-right px-4 py-3 font-medium">Inflow</th>
                  <th className="text-right px-4 py-3 font-medium">Outflow</th>
                  <th className="text-right px-4 py-3 font-medium">Net</th>
                  <th className="text-right px-4 py-3 font-medium">Closing</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.ledger_name} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{r.ledger_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure text-secondary-500">{formatCurrency(r.opening, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure text-success-600 dark:text-success-400">{r.inflow ? formatCurrency(r.inflow, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure text-error-600 dark:text-error-400">{r.outflow ? formatCurrency(r.outflow, activeBusiness?.currency_symbol) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-semibold">{formatCurrency(r.net, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure">{formatCurrency(r.closing, activeBusiness?.currency_symbol)}</td>
                  </tr>
                ))}
                {filtered.length > 1 && (
                  <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 bg-secondary-50/70 dark:bg-secondary-800/50">
                    <td className="px-4 py-3 font-bold text-secondary-900 dark:text-secondary-100">
                      {filtered.length === rows.length ? 'All cash & bank ledgers' : `${filtered.length} ledgers`}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-bold">{formatCurrency(Math.round(filtered.reduce((t, r) => t + r.opening, 0) * 100) / 100, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-bold">{formatCurrency(Math.round(filtered.reduce((t, r) => t + r.inflow, 0) * 100) / 100, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-bold">{formatCurrency(Math.round(filtered.reduce((t, r) => t + r.outflow, 0) * 100) / 100, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-bold">{formatCurrency(Math.round(filtered.reduce((t, r) => t + r.net, 0) * 100) / 100, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure font-bold">{formatCurrency(Math.round(filtered.reduce((t, r) => t + r.closing, 0) * 100) / 100, activeBusiness?.currency_symbol)}</td>
                  </tr>
                )}
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
          isLoading={report.isLoading}
        />
      </div>

      {activeBusiness && (
        <TransferFundsModal
          open={transferOpen}
          onClose={() => setTransferOpen(false)}
          accounts={accountsQuery.data ?? []}
          businessId={activeBusiness.id}
          currencySymbol={activeBusiness.currency_symbol}
          onTransferred={(entryNumber) => {
            qc.invalidateQueries({ queryKey: ['cash-bank-movements'] });
            toast(entryNumber ? `Transferred - JE ${entryNumber}` : 'Transfer posted', 'success');
          }}
        />
      )}
    </div>
  );
}
