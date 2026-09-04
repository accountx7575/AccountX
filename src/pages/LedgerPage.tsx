import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { BookOpen, Printer, Download } from 'lucide-react';
import { formatCurrency, formatDate, todayDateString, roundTo2, cn } from '@/lib/utils';
import { fetchLedgerLines } from '@/lib/accounting';
import { PageMotion } from '@/lib/motion';

type LedgerRow = {
  date: string;
  particular: string;
  debit: number;
  credit: number;
};

function downloadCsv(filename: string, matrix: (string | number)[][]): void {
  const escapeCell = (cell: string | number) => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = matrix.map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function drCrTone(v: number): string {
  return v >= 0
    ? 'text-emerald-700 dark:text-emerald-400'
    : 'text-rose-600 dark:text-rose-400';
}

export function LedgerPage() {
  const { activeBusiness } = useAuth();
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState(todayDateString());

  const { data: accounts } = useQuery({
    queryKey: ['accounts', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('accounts').select('*').eq('business_id', activeBusiness.id).order('name');
      return data;
    },
    enabled: !!activeBusiness,
  });

  const { data: lines, isLoading, isError, refetch } = useQuery({
    queryKey: ['journal-lines-ledger', activeBusiness?.id, accountId, fromDate, toDate],
    queryFn: () => fetchLedgerLines(activeBusiness!.id, accountId, fromDate || undefined, toDate || undefined),
    enabled: !!activeBusiness && !!accountId,
  });

  const selectedAccount = useMemo(
    () => accounts?.find((a: any) => a.id === accountId),
    [accounts, accountId]
  );

  const ledgerRows: LedgerRow[] = useMemo(() => {
    if (!lines) return [];
    return lines.map((l) => ({
      date: l.entry?.date || l.created_at,
      particular: l.entry?.narration || l.account_name,
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
    }));
  }, [lines]);

  const openingBalance = selectedAccount ? Number(selectedAccount.opening_balance) || 0 : 0;
  const rowsWithBalance = useMemo(() => {
    let running = openingBalance;
    return ledgerRows.map((r) => {
      running = roundTo2(running + r.debit - r.credit);
      return { ...r, balance: running };
    });
  }, [ledgerRows, openingBalance]);

  const totalDebit = roundTo2(ledgerRows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = roundTo2(ledgerRows.reduce((s, r) => s + r.credit, 0));
  const closingBalance = roundTo2(openingBalance + totalDebit - totalCredit);
  const sym = activeBusiness?.currency_symbol || '₹';

  const handleExport = () => {
    downloadCsv(`ledger_${selectedAccount?.name ?? 'account'}_${fromDate || 'start'}_${toDate}.csv`, [
      ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'],
      ['—', `Opening Balance (${openingBalance >= 0 ? 'Dr' : 'Cr'})`, '', '', openingBalance],
      ...rowsWithBalance.map((r) => [formatDate(r.date), r.particular, r.debit, r.credit, r.balance]),
      ['', `Closing Balance (${closingBalance >= 0 ? 'Dr' : 'Cr'})`, totalDebit, totalCredit, closingBalance],
    ]);
  };

  return (
    <PageMotion>
      <PageHeader title="Ledger" subtitle="View account-wise transaction history"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={!accountId}><Printer className="h-3.5 w-3.5" /> Print</Button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!rowsWithBalance.length}><Download className="h-3.5 w-3.5" /> Export</Button>
          </div>
        }
      />

      <div className="card p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="label">Select Account</label>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select account...</option>
              {accounts?.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="label">From Date</label>
            <DatePicker value={fromDate} onChange={setFromDate} />
          </div>
          <div>
            <label className="label">To Date</label>
            <DatePicker value={toDate} onChange={setToDate} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" variant="secondary" disabled title="Ledger updates automatically as filters change">Apply Filter</Button>
          </div>
        </div>
        {selectedAccount && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-secondary-100 dark:border-secondary-800">
            <span className="text-xs text-secondary-400">Viewing:</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              <BookOpen className="h-3 w-3" />
              {selectedAccount.name}
              <span className="figure font-normal text-indigo-500/70 dark:text-indigo-400/70">
                open. {formatCurrency(Math.abs(openingBalance), sym)} {openingBalance >= 0 ? 'Dr' : 'Cr'}
              </span>
            </span>
            {fromDate && toDate && (
              <span className="text-xs text-secondary-400 figure">{formatDate(fromDate)} → {formatDate(toDate)}</span>
            )}
          </div>
        )}
      </div>

      {!accountId ? (
        <EmptyState icon={BookOpen} title="Select an account" description="Choose an account from the dropdown above to view its ledger" />
      ) : isError ? (
        <ErrorState title="Unable to load ledger." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="card p-8 space-y-3">{[1,2,3,4,5].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
      ) : rowsWithBalance.length === 0 ? (
        <EmptyState icon={BookOpen} title="No transactions found" description="This account has no entries in the selected date range" />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400 bg-secondary-50 dark:bg-secondary-800/50">
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Particulars</th>
                  <th className="text-right px-4 py-3 font-medium">Debit</th>
                  <th className="text-right px-4 py-3 font-medium">Credit</th>
                  <th className="text-right px-4 py-3 font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-secondary-100 dark:border-secondary-800/50 bg-secondary-50/50 dark:bg-secondary-800/30">
                  <td className="px-4 py-3 text-secondary-400">—</td>
                  <td className="px-4 py-3 text-secondary-500 italic">Opening Balance</td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className={cn('px-4 py-3 text-right tabular-nums figure font-medium', drCrTone(openingBalance))}>{formatCurrency(Math.abs(openingBalance), sym)} {openingBalance >= 0 ? 'Dr' : 'Cr'}</td>
                </tr>
                {rowsWithBalance.map((r, i) => (
                  <tr key={i} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 text-secondary-500 whitespace-nowrap figure">{formatDate(r.date)}</td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{r.particular}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure">{r.debit > 0 ? formatCurrency(r.debit, sym) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums figure">{r.credit > 0 ? formatCurrency(r.credit, sym) : '—'}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums figure font-medium', drCrTone(r.balance))}>{formatCurrency(Math.abs(r.balance), sym)} {r.balance >= 0 ? 'Dr' : 'Cr'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-secondary-200 dark:border-secondary-700 font-semibold">
                  <td className="px-4 py-3" colSpan={2}>Total Movements</td>
                  <td className="px-4 py-3 text-right tabular-nums figure">{formatCurrency(totalDebit, sym)}</td>
                  <td className="px-4 py-3 text-right tabular-nums figure">{formatCurrency(totalCredit, sym)}</td>
                  <td className={cn('px-4 py-3 text-right tabular-nums figure', drCrTone(closingBalance))}>{formatCurrency(Math.abs(closingBalance), sym)} {closingBalance >= 0 ? 'Dr' : 'Cr'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </PageMotion>
  );
}
