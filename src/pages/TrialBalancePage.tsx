import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Badge } from '@/components/ui/Badge';
import { Landmark, Printer, Download } from 'lucide-react';
import { formatCurrency, todayDateString, roundTo2, cn } from '@/lib/utils';
import { fetchTrialBalance, type TrialBalanceRow } from '@/lib/accounting';
import { PageMotion } from '@/lib/motion';

export function TrialBalancePage() {
  const { activeBusiness } = useAuth();
  const [asOfDate, setAsOfDate] = useState(todayDateString());

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ['trial-balance', activeBusiness?.id, asOfDate],
    queryFn: () => fetchTrialBalance(activeBusiness!.id, asOfDate),
    enabled: !!activeBusiness && !!asOfDate,
  });

  const grouped = useMemo(() => {
    if (!rows) return {} as Record<string, TrialBalanceRow[]>;
    return rows.reduce((acc, r) => {
      if (!acc[r.group_name]) acc[r.group_name] = [];
      acc[r.group_name].push(r);
      return acc;
    }, {} as Record<string, TrialBalanceRow[]>);
  }, [rows]);

  const totals = useMemo(() => {
    if (!rows) return { debit: 0, credit: 0 };
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      if (r.nature === 'debit') {
        debit += r.closing_balance;
      } else {
        credit += r.closing_balance;
      }
    }
    return { debit: roundTo2(debit), credit: roundTo2(credit) };
  }, [rows]);

  const isBalanced = totals.debit === totals.credit;
  const sym = activeBusiness?.currency_symbol || '₹';

  const handleExport = () => {
    if (!rows) return;
    const escapeCell = (cell: string | number) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const matrix: (string | number)[][] = [
      ['Account', 'Code', 'Group', 'Nature', 'Opening', 'Period Debit', 'Period Credit', 'Closing'],
      ...rows.map((r) => [r.account_name, r.code || '', r.group_name, r.nature, r.opening_balance, r.period_debit, r.period_credit, r.closing_balance]),
      ['Grand Total', '', '', `Dr ${totals.debit} / Cr ${totals.credit}`, '', '', '', ''],
    ];
    const csv = matrix.map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial_balance_${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageMotion>
      <PageHeader
        title="Trial Balance"
        subtitle="Verify debit and credit balances match"
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              As on {asOfDate}
            </span>
            {rows && (
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', isBalanced ? 'bg-success-50 dark:bg-success-900/30 text-success-700 dark:text-success-300' : 'bg-error-50 dark:bg-error-900/30 text-error-700 dark:text-error-300')}>
                {isBalanced ? 'Balanced' : 'Out of balance'}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={!rows}><Printer className="h-3.5 w-3.5" /> Print</Button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!rows}><Download className="h-3.5 w-3.5" /> Export</Button>
          </div>
        }
      />

      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="label">As of Date</label>
            <DatePicker value={asOfDate} onChange={setAsOfDate} />
          </div>
        </div>
      </div>

      {isError ? (
        <ErrorState title="Unable to load Trial Balance." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="card p-8 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No accounts found"
          description="Create accounts and post journal entries to see the trial balance"
        />
      ) : (
        <>
          <div className="space-y-4 mb-6">
            {Object.entries(grouped).map(([group, acctRows]) => (
              <div key={group} className="card">
                <div className="px-4 py-3 border-b border-secondary-200 dark:border-secondary-800">
                  <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">{group}</h3>
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-secondary-100 dark:border-secondary-800/50 text-secondary-500 dark:text-secondary-400">
                        <th className="text-left px-4 py-2 font-medium">Account</th>
                        <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Code</th>
                        <th className="text-right px-4 py-2 font-medium">Opening</th>
                        <th className="text-right px-4 py-2 font-medium">Debit</th>
                        <th className="text-right px-4 py-2 font-medium">Credit</th>
                        <th className="text-right px-4 py-2 font-medium">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acctRows.map((r) => (
                        <tr key={r.account_id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                          <td className="px-4 py-2 font-medium text-secondary-900 dark:text-secondary-100">
                            {r.account_name}
                            <Badge variant={r.nature === 'debit' ? 'info' : 'neutral'} className="ml-2">{r.nature === 'debit' ? 'Dr' : 'Cr'}</Badge>
                          </td>
                          <td className="px-4 py-2 hidden sm:table-cell text-secondary-500 font-mono text-xs">{r.code || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-secondary-500">{formatCurrency(r.opening_balance, sym)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.period_debit > 0 ? formatCurrency(r.period_debit, sym) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.period_credit > 0 ? formatCurrency(r.period_credit, sym) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100">
                            {formatCurrency(Math.abs(r.closing_balance), sym)} {r.closing_balance >= 0 ? 'Dr' : 'Cr'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className={cn('card p-6', isBalanced ? 'ring-1 ring-success-500/30' : 'ring-1 ring-error-500/40')}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100">Grand Total</h3>
              <Badge variant={isBalanced ? 'success' : 'error'}>
                {isBalanced ? 'Balanced' : 'Out of Balance'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-primary-50 dark:bg-primary-900/20 p-4">
                <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-1 uppercase tracking-wide font-medium">Total Debit</p>
                <p className="text-2xl font-bold text-secondary-900 dark:text-secondary-100 tabular-nums figure">{formatCurrency(totals.debit, sym)}</p>
              </div>
              <div className="rounded-lg bg-accent-50 dark:bg-accent-900/20 p-4">
                <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-1 uppercase tracking-wide font-medium">Total Credit</p>
                <p className="text-2xl font-bold text-secondary-900 dark:text-secondary-100 tabular-nums figure">{formatCurrency(totals.credit, sym)}</p>
              </div>
            </div>
            {!isBalanced && (
              <div className="mt-4 rounded-lg bg-error-50 dark:bg-error-900/20 p-3">
                <p className="text-sm text-error-700 dark:text-error-300">
                  Difference: {formatCurrency(Math.abs(totals.debit - totals.credit), sym)}. Check for unbalanced journal entries.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </PageMotion>
  );
}
