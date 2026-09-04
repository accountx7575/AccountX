import { Fragment, useEffect, useState } from 'react';
import { Link, Navigate, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Download, FileDown, Wallet, ClipboardList, Hourglass, BookOpen, ReceiptText, FileText, ShoppingBag, HandCoins, Banknote, Sparkles, AlertCircle, Share2, Send, MessageCircle, Boxes } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { useAiAssistant } from '@/hooks/useAiAssistant';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { SendDialog } from '@/components/comms/SendDialog';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { PageMotion } from '@/lib/motion';
import {
  getReportMeta,
  resolvePreset,
  fetchProfitLoss,
  fetchBalanceSheet,
  fetchCashFlow,
  fetchDayBook,
  fetchAging,
  fetchPartyLedger,
  fetchGstSummary,
  fetchSalesRegister,
  fetchPurchaseRegister,
  fetchGstr1,
  fetchGstr3b,
  fetchReceivablesDetail,
  fetchPayablesDetail,
  fetchCashBankMovements,
  fetchExpenseReport,
  fetchStockReport,
  type OutstandingRow,
  summarizeGst,
  summarizeGstr1Docs,
  ReportNotReadyError,
  type DateRange,
  type AgingSide,
  type StatementSide,
} from '@/lib/reportsAdapter';

/* ------------------------------- csv helper ------------------------------- */

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

/* ------------------------------ table atoms ------------------------------- */

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
        right ? 'text-right' : 'text-left'
      )}
    >
      {children}
    </th>
  );
}

function TdNum({ children, emphasis, className }: { children?: React.ReactNode; emphasis?: boolean; className?: string }) {
  return (
    <td className={cn('figure text-right px-3 py-2 whitespace-nowrap', emphasis ? 'font-bold' : '', className)}>
      {children}
    </td>
  );
}

function BandRow({ label, colSpan, strong }: { label: string; colSpan: number; strong?: boolean }) {
  return (
    <tr className="bg-secondary-50/70 dark:bg-secondary-800/50">
      <td
        colSpan={colSpan}
        className={cn(
          'px-3 py-2 text-secondary-900 dark:text-secondary-100',
          strong ? 'font-bold' : 'font-semibold'
        )}
      >
        {label}
      </td>
    </tr>
  );
}

/* --------------------------- family renderers ----------------------------- */

type ReportData =
  | Awaited<ReturnType<typeof fetchProfitLoss>>
  | Awaited<ReturnType<typeof fetchBalanceSheet>>
  | Awaited<ReturnType<typeof fetchCashFlow>>
  | Awaited<ReturnType<typeof fetchDayBook>>
  | Awaited<ReturnType<typeof fetchAging>>
  | Awaited<ReturnType<typeof fetchPartyLedger>>
  | Awaited<ReturnType<typeof fetchGstSummary>>
  | Awaited<ReturnType<typeof fetchSalesRegister>>
  | Awaited<ReturnType<typeof fetchPurchaseRegister>>
  | Awaited<ReturnType<typeof fetchReceivablesDetail>>
| Awaited<ReturnType<typeof fetchPayablesDetail>>
| Awaited<ReturnType<typeof fetchCashBankMovements>>
| Awaited<ReturnType<typeof fetchGstr1>>
| Awaited<ReturnType<typeof fetchGstr3b>>
| Awaited<ReturnType<typeof fetchExpenseReport>>
| Awaited<ReturnType<typeof fetchStockReport>>;

function ProfitLossView({ data }: { data: Extract<ReportData, { kind: 'profit-loss' }> }) {
  const cells: React.ReactNode[] = [];
  let lastSection = '';
  let lastGroup = '';
  let groupSum = 0;
  let haveGroup = false;
  const flushSubtotal = (key: string) => {
    if (!haveGroup) return;
    cells.push(
      <tr key={key} className="border-t border-secondary-200 dark:border-secondary-700">
        <td className="px-3 py-1.5 pl-6 text-xs font-semibold uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
          Subtotal · {lastGroup}
        </td>
        <TdNum emphasis>{formatCurrency(groupSum)}</TdNum>
      </tr>
    );
    haveGroup = false;
    groupSum = 0;
  };
  for (const r of data.rows) {
    const isNetProfit = r.section === 'Summary' && r.group_name === 'Net Profit';
    if (isNetProfit) {
      flushSubtotal('sub-pre-net');
      cells.push(
        <tr key="net-profit" className="bg-primary-50/60 dark:bg-primary-900/20 border-y-2 border-primary-500/60">
          <td className="px-3 py-3 font-bold text-base text-secondary-900 dark:text-secondary-100">Net Profit</td>
          <TdNum emphasis>{formatCurrency(r.amount)}</TdNum>
        </tr>
      );
      continue;
    }
    if (r.section !== lastSection) {
      flushSubtotal(`sub-${lastSection}-${lastGroup}-end`);
      cells.push(<BandRow key={`s-${r.section}`} label={r.section} colSpan={2} />);
      lastSection = r.section;
      lastGroup = '';
    }
    if (r.account_name === null) {
      if (r.group_name !== lastGroup) {
        flushSubtotal(`sub-${lastSection}-${lastGroup}`);
        cells.push(
          <tr key={`g-${r.section}-${r.group_name}`}>
            <td className="px-3 py-1.5 pl-6 font-semibold text-secondary-700 dark:text-secondary-300">
              {r.group_name}
            </td>
            <TdNum />
          </tr>
        );
        lastGroup = r.group_name;
      }
      continue;
    }
    groupSum += Number(r.amount);
    haveGroup = true;
    cells.push(
      <tr key={`${r.account_id}`}>
        <td className="px-3 py-1.5 pl-10 text-secondary-600 dark:text-secondary-400">{r.account_name}</td>
        <TdNum>{formatCurrency(r.amount)}</TdNum>
      </tr>
    );
  }
  flushSubtotal('sub-final');
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <Th>Particulars</Th>
          <Th right>Amount</Th>
        </tr>
      </thead>
      <tbody>{cells}</tbody>
    </table>
  );
}

const NATURE_SECTION: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
};

function BalanceSheetView({ data }: { data: Extract<ReportData, { kind: 'balance-sheet' }> }) {
  const cells: React.ReactNode[] = [];
  let lastNature = '';
  let lastGroup = '';
  let groupSum = 0;
  let haveGroup = false;
  const flushSubtotal = (key: string) => {
    if (!haveGroup) return;
    cells.push(
      <tr key={key} className="border-t border-secondary-200 dark:border-secondary-700">
        <td className="px-3 py-1.5 pl-6 text-xs font-semibold uppercase tracking-wide text-secondary-500 dark:text-secondary-400">
          Subtotal · {lastGroup}
        </td>
        <TdNum emphasis>{formatCurrency(groupSum)}</TdNum>
      </tr>
    );
    haveGroup = false;
    groupSum = 0;
  };
  for (const r of data.rows) {
    if (r.nature !== lastNature) {
      flushSubtotal(`sub-${lastNature}-${lastGroup}-end`);
      cells.push(
        <BandRow key={`n-${r.nature}`} label={NATURE_SECTION[r.nature] ?? r.nature} colSpan={2} />
      );
      lastNature = r.nature;
      lastGroup = '';
    }
    if (r.account_name === null) {
      if (r.group_name !== lastGroup) {
        flushSubtotal(`sub-${lastNature}-${lastGroup}`);
        cells.push(
          <tr key={`g-${r.nature}-${r.group_name}`}>
            <td className="px-3 py-1.5 pl-6 font-semibold text-secondary-700 dark:text-secondary-300">
              {r.group_name}
            </td>
            <TdNum />
          </tr>
        );
        lastGroup = r.group_name;
      }
      continue;
    }
    groupSum += Number(r.closing_balance);
    haveGroup = true;
    cells.push(
      <tr key={`${r.account_id}`}>
        <td className="px-3 py-1.5 pl-10 text-secondary-600 dark:text-secondary-400">{r.account_name}</td>
        <TdNum>{formatCurrency(r.closing_balance)}</TdNum>
      </tr>
    );
  }
  flushSubtotal('sub-final');
  return (
    <div>
      <p className="figure text-xs text-secondary-400 mb-2">As on {data.asOf}</p>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Particulars</Th>
            <Th right>Closing Balance</Th>
          </tr>
        </thead>
        <tbody>{cells}</tbody>
      </table>
    </div>
  );
}

function CashFlowView({ data }: { data: Extract<ReportData, { kind: 'cash-flow' }> }) {
  const totalIn = data.daily.reduce((s, d) => s + d.inflow, 0);
  const totalOut = data.daily.reduce((s, d) => s + d.outflow, 0);
  if (data.daily.length === 0) return <EmptyState icon={Wallet} title="No cash movement" description="No transactions recorded in this period." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th right>Money In</Th>
          <Th right>Money Out</Th>
        </tr>
      </thead>
      <tbody>
        {data.daily.map((d) => (
          <tr key={d.flow_date}>
            <td className="figure px-3 py-2 text-secondary-600 dark:text-secondary-400">{d.flow_date}</td>
            <TdNum>{formatCurrency(d.inflow)}</TdNum>
            <TdNum>{formatCurrency(d.outflow)}</TdNum>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 font-semibold">
          <td className="px-3 py-2">Period total</td>
          <TdNum emphasis>{formatCurrency(totalIn)}</TdNum>
          <TdNum emphasis>{formatCurrency(totalOut)}</TdNum>
        </tr>
      </tfoot>
    </table>
  );
}

function DayBookView({ data }: { data: Extract<ReportData, { kind: 'day-book' }> }) {
  if (data.entries.length === 0) return <EmptyState icon={ClipboardList} title="No transactions" description="Nothing was posted in this period." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Type</Th>
          <Th>Doc #</Th>
          <Th>Party</Th>
          <Th>Description</Th>
          <Th>Debit A/c</Th>
          <Th>Credit A/c</Th>
          <Th right>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {data.entries.map((e) => (
          <tr key={`${e.doc_id}`} className="break-inside-avoid">
            <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{e.entry_date}</td>
            <td className="px-3 py-2"><Badge variant="neutral">{e.doc_type}</Badge></td>
            <td className="figure px-3 py-2 whitespace-nowrap">{e.doc_number}</td>
            <td className="px-3 py-2 text-secondary-600 dark:text-secondary-400">{e.party_name ?? '—'}</td>
            <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400 max-w-[16rem] truncate">{e.description ?? '—'}</td>
            <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400">{e.debit_ledger}</td>
            <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400">{e.credit_ledger}</td>
            <TdNum>{formatCurrency(e.amount)}</TdNum>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpenseReportView({ data }: { data: Extract<ReportData, { kind: 'expense-report' }> }) {
  if (data.rows.length === 0) return <EmptyState icon={ReceiptText} title="No expenses" description="Nothing was recorded in this period." />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Expense #</Th>
          <Th>Category</Th>
          <Th>Description</Th>
          <Th>Method</Th>
          <Th right>Net</Th>
          <Th right>Tax</Th>
          <Th right>Total</Th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.expense_id} className="break-inside-avoid">
            <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{formatDate(r.expense_date)}</td>
            <td className="figure px-3 py-2 whitespace-nowrap">{r.expense_number}</td>
            <td className="px-3 py-2"><Badge variant="neutral">{r.category_name}</Badge></td>
            <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400 max-w-[16rem] truncate">{r.description ?? '-'}</td>
            <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400 uppercase text-xs">{r.payment_method ?? '-'}</td>
            <TdNum>{formatCurrency(r.net_amount)}</TdNum>
            <TdNum>{formatCurrency(r.tax_amount)}</TdNum>
            <TdNum emphasis>{formatCurrency(r.total_amount)}</TdNum>
          </tr>
        ))}
        <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 font-semibold">
          <td className="px-3 py-2" colSpan={5}>Total</td>
          <TdNum emphasis>{formatCurrency(data.totals.net)}</TdNum>
          <TdNum emphasis>{formatCurrency(data.totals.tax)}</TdNum>
          <TdNum emphasis>{formatCurrency(data.totals.total)}</TdNum>
        </tr>
      </tbody>
    </table>
  );
}

function StockReportView({ data }: { data: Extract<ReportData, { kind: 'stock-report' }> }) {
  if (data.valuation.length === 0 && data.movements.length === 0)
    return <EmptyState icon={Boxes} title="No stock activity" description="No valuation data or movements in this period." />;
  const totalRow = data.valuation.find((v) => v.product_id === null);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 dark:text-secondary-400 mb-2">Valuation (FIFO cost layers)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Product</Th>
              <Th right>Quantity</Th>
              <Th right>Avg Cost</Th>
              <Th right>Value</Th>
            </tr>
          </thead>
          <tbody>
            {data.valuation.map((v, i) => (
              <tr key={`${v.product_id ?? 'all'}-${i}`} className={cn('break-inside-avoid', v.product_id === null && 'font-semibold border-t border-secondary-300 dark:border-secondary-600')}>
                <td className="px-3 py-2">{v.product_name}</td>
                <TdNum>{v.quantity}</TdNum>
                <TdNum>{formatCurrency(v.avg_cost)}</TdNum>
                <TdNum emphasis>{formatCurrency(v.total_value)}</TdNum>
              </tr>
            ))}
            {data.valuation.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-secondary-500">No stock on record.</td></tr>
            )}
          </tbody>
        </table>
        {totalRow && (
          <p className="mt-1 text-xs text-secondary-400">
            Company total across {data.valuation.length - 1} product(s); oversold histories contribute zero value by design.
          </p>
        )}
      </div>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary-500 dark:text-secondary-400 mb-2">Movement ledger ({data.movements.length})</h3>
        {data.movements.length === 0 ? (
          <p className="px-3 py-2 text-sm text-secondary-500">No movements in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th>Warehouse</Th>
                <Th>Type</Th>
                <Th right>Qty</Th>
                <Th right>Balance After</Th>
                <Th right>Unit Cost</Th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m) => (
                <tr key={m.id} className="break-inside-avoid">
                  <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{m.created_at.slice(0, 10)}</td>
                  <td className="px-3 py-2">{m.product?.name ?? m.product_id}</td>
                  <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400">{m.warehouse?.name ?? '-'}</td>
                  <td className="px-3 py-2"><Badge variant="neutral">{m.type}</Badge></td>
                  <TdNum>{m.quantity}</TdNum>
                  <TdNum>{m.balance_after}</TdNum>
                  <TdNum>{m.unit_cost != null ? formatCurrency(m.unit_cost) : '-'}</TdNum>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const AGING_BUCKETS: { key: keyof Pick<
  import('@/lib/reportsAdapter').AgingDocRow,
  'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_90_plus'
>; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'days_1_30', label: '1–30' },
  { key: 'days_31_60', label: '31–60' },
  { key: 'days_61_90', label: '61–90' },
  { key: 'days_90_plus', label: '90+' },
];

function AgingView({
  data,
  side,
  onSideChange,
}: {
  data: Extract<ReportData, { kind: 'ar-ap-aging' }>;
  side: AgingSide;
  onSideChange: (s: AgingSide) => void;
}) {
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={Hourglass}
        title={side === 'receivable' ? 'No receivables outstanding' : 'No payables outstanding'}
        description="Every document in scope is settled as of this date."
      />
    );
  const t = data.totals;
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 print:hidden">
        {(['receivable', 'payable'] as AgingSide[]).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => onSideChange(s)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              side === s
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400'
            )}
          >
            {s === 'receivable' ? 'Receivables (AR)' : 'Payables (AP)'}
          </button>
        ))}
        <span className="ml-auto figure text-xs text-secondary-400">As on {data.asOf} · buckets = days past due</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Party</Th>
            <Th>Document</Th>
            <Th>Due Date</Th>
            {AGING_BUCKETS.map((b) => (
              <Th key={b.key} right>
                {b.label}
              </Th>
            ))}
            <Th right>Outstanding</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.doc_id} className="break-inside-avoid">
              <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">{r.party_name}</td>
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{r.doc_number}</td>
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.due_date}</td>
              {AGING_BUCKETS.map((b) => {
                const v = r[b.key];
                const tone =
                  !v
                    ? ''
                    : b.key === 'days_90_plus'
                      ? 'text-error-600 dark:text-error-400 font-semibold'
                      : b.key === 'days_31_60' || b.key === 'days_61_90'
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : '';
                return (
                  <TdNum key={b.key} className={tone}>
                    {v ? formatCurrency(v) : '—'}
                  </TdNum>
                );
              })}
              <TdNum>{formatCurrency(r.outstanding)}</TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 font-semibold">
            <td className="px-3 py-2" colSpan={3}>
              Total
            </td>
            {AGING_BUCKETS.map((b) => (
              <TdNum key={b.key} emphasis>
                {formatCurrency(t[b.key])}
              </TdNum>
            ))}
            <TdNum emphasis>{formatCurrency(t.outstanding)}</TdNum>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PartyLedgerView({
  data,
}: {
  data: Extract<ReportData, { kind: 'party-ledger' }>;
}) {
  const owesThem = data.closing < 0;
  const semantics =
    data.side === 'customer'
      ? owesTheyLabel(data.closing, 'owes you', 'credit balance')
      : owesTheyLabel(data.closing, 'you owe them', 'advance / credit');
  if (data.entries.length === 0)
    return <EmptyState icon={BookOpen} title="No ledger entries" description="No statements recorded for this party in the selected period." />;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 pb-4 border-b border-secondary-100 dark:border-secondary-800">
        {typeof data.opening === 'number' && (
          <span className="text-sm text-secondary-500 dark:text-secondary-400">
            Opening: <span className="figure font-semibold text-secondary-900 dark:text-secondary-100">{formatCurrency(data.opening)}</span>
          </span>
        )}
        <span className="text-sm ml-auto">
          Closing:{' '}
          <span className={cn('figure font-bold', owesThem ? 'text-error-600 dark:text-error-400' : 'text-success-600 dark:text-success-400')}>
            {formatCurrency(data.closing)}
          </span>{' '}
          <span className="text-xs text-secondary-400">({semantics})</span>
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Doc #</Th>
            <Th>Description</Th>
            <Th right>Debit</Th>
            <Th right>Credit</Th>
            <Th right>Balance</Th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e, i) => (
            <tr key={`${e.doc_number}-${i}`} className="break-inside-avoid">
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{e.entry_date}</td>
              <td className="px-3 py-2"><Badge variant="neutral">{e.doc_type}</Badge></td>
              <td className="figure px-3 py-2 whitespace-nowrap">{e.doc_number}</td>
              <td className="px-3 py-2 text-secondary-500 dark:text-secondary-400 max-w-[18rem] truncate">{e.description ?? '—'}</td>
              <TdNum>{e.debit_amount ? formatCurrency(e.debit_amount) : '—'}</TdNum>
              <TdNum>{e.credit_amount ? formatCurrency(e.credit_amount) : '—'}</TdNum>
              <TdNum emphasis>{formatCurrency(e.running_balance)}</TdNum>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-secondary-400 print:hidden">
        Sign convention: customer positive = they owe you · supplier positive = you owe them. Balances shown verbatim from the ledger.
      </p>
    </div>
  );
}

function owesTheyLabel(closing: number, positiveLabel: string, negativeLabel: string): string {
  return closing >= 0 ? positiveLabel : negativeLabel;
}

const GST_TAX_COLS = [
  { key: 'taxable_amount', label: 'Taxable' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'igst', label: 'IGST' },
  { key: 'cess', label: 'Cess' },
  { key: 'net_amount', label: 'Net' },
] as const;

function GstSummaryView({ data }: { data: Extract<ReportData, { kind: 'gst-summary' }> }) {
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={ReceiptText}
        title="No GST activity"
        description="No outward or inward tax documents were posted in this period."
      />
    );
  const netRow = data.rows.find((r) => r.ledger_name === 'Net GST Payable');
  const summary = netRow ? summarizeGst(data.rows) : null;
  const cells: React.ReactNode[] = [];
  let lastSection = '';
  for (const r of data.rows) {
    if (r.ledger_name === 'Net GST Payable') continue;
    if (r.section !== lastSection) {
      cells.push(<BandRow key={`s-${r.section}`} label={r.section} colSpan={7} />);
      lastSection = r.section;
    }
    cells.push(
      <tr key={`${r.section}-${r.ledger_name}`} className="break-inside-avoid">
        <td className="px-3 py-1.5 pl-6 font-medium text-secondary-900 dark:text-secondary-100">{r.ledger_name}</td>
        {GST_TAX_COLS.map((c) => (
          <TdNum key={c.key}>{formatCurrency(r[c.key])}</TdNum>
        ))}
      </tr>
    );
  }
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Ledger</Th>
            {GST_TAX_COLS.map((c) => (
              <Th key={c.key} right>
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>{cells}</tbody>
        {netRow && summary && (
          <tfoot>
            <tr className="border-t-2 border-primary-500/60">
              <td className="px-3 py-2.5 font-bold text-secondary-900 dark:text-secondary-100">
                {summary.netLabel}
                {summary.netPosition < 0 && (
                  <span className="ml-2 text-xs font-medium text-success-600 dark:text-success-400">
                    (credit carried forward — nothing payable)
                  </span>
                )}
              </td>
              <TdNum emphasis>{formatCurrency(summary.outwardTaxable)}</TdNum>
              <TdNum emphasis>{formatCurrency(netRow.cgst)}</TdNum>
              <TdNum emphasis>{formatCurrency(netRow.sgst)}</TdNum>
              <TdNum emphasis>{formatCurrency(netRow.igst)}</TdNum>
              <TdNum emphasis>{formatCurrency(netRow.cess)}</TdNum>
              <TdNum emphasis>{formatCurrency(netRow.net_amount)}</TdNum>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="mt-3 text-xs text-secondary-400 print:hidden">
        Outward = output tax collected on sales · Inward = input tax credit on purchases. Figures verbatim from the reporting core.
      </p>
    </div>
  );
}

/* ------------------------------ main page --------------------------------- */

type PartyOption = { id: string; name: string };

const AI_REPORT_IDS = new Set([
  'profit-loss',
  'balance-sheet',
  'cash-flow',
  'party-ledger',
  'gst-summary',
  'gstr-1',
  'gstr-3b',
]);

export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const meta = getReportMeta(reportId);
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id;
  const ai = useAiAssistant();

  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));
  const [agingSide, setAgingSide] = useState<AgingSide>('receivable');
  const [statementSide, setStatementSide] = useState<StatementSide>('customer');
  const [partyId, setPartyId] = useState('');
  const [sendChannel, setSendChannel] = useState<'email' | 'whatsapp' | null>(null);

  const needsParty = meta?.id === 'party-ledger';

  const parties = useQuery({
    queryKey: ['report-parties', statementSide, businessId],
    queryFn: async (): Promise<PartyOption[]> => {
      const table = statementSide === 'customer' ? 'customers' : 'suppliers';
      const { data, error } = await supabase
        .from(table)
        .select('id, name')
        .eq('business_id', businessId!)
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      return (data ?? []) as PartyOption[];
    },
    enabled: !!meta && needsParty && !!businessId,
  });

  useEffect(() => {
    if (needsParty && !partyId && parties.data && parties.data.length > 0) {
      setPartyId(parties.data[0].id);
    }
    if (needsParty && partyId && parties.data && !parties.data.some((p) => p.id === partyId)) {
      setPartyId(parties.data[0]?.id ?? '');
    }
  }, [needsParty, parties.data, partyId]);

  const report = useQuery({
    queryKey: ['report', meta?.id, businessId, range.from, range.to, agingSide, statementSide, partyId],
    queryFn: async (): Promise<ReportData> => {
      const bid = businessId!;
      switch (meta!.id) {
        case 'profit-loss':
          return fetchProfitLoss({ businessId: bid, range });
        case 'balance-sheet':
          return fetchBalanceSheet({ businessId: bid, asOf: range.to });
        case 'cash-flow':
          return fetchCashFlow({ businessId: bid, range });
        case 'day-book':
          return fetchDayBook({ businessId: bid, range });
        case 'ar-ap-aging':
          return fetchAging({ businessId: bid, asOf: range.to, side: agingSide });
        case 'party-ledger':
          return fetchPartyLedger({ businessId: bid, range, side: statementSide, partyId });
        case 'gst-summary':
          return fetchGstSummary({ businessId: bid, range });
        case 'sales-register':
          return fetchSalesRegister({ businessId: bid, range });
        case 'purchase-register':
          return fetchPurchaseRegister({ businessId: bid, range });
        case 'receivables':
          return fetchReceivablesDetail({ businessId: bid, range });
        case 'payables':
          return fetchPayablesDetail({ businessId: bid, range });
        case 'cash-bank':
          return fetchCashBankMovements({ businessId: bid, range });
        case 'gstr-1':
          return fetchGstr1({ businessId: bid, range });
        case 'gstr-3b':
          return fetchGstr3b({ businessId: bid, range });
        case 'expense-report':
          return fetchExpenseReport({ businessId: bid, range });
        case 'stock-report':
          return fetchStockReport({ businessId: bid, range });
      }
    },
    enabled: !!meta && !!businessId && meta.status !== 'wiring' && (!needsParty || !!partyId),
  });

  if (!meta) return <Navigate to="/app/reports" replace />;

  const Icon = meta.icon;
  const generatedAt = report.dataUpdatedAt ? new Date(report.dataUpdatedAt).toLocaleString() : '';

  const buildCsv = (): (string | number)[][] | null => {
    const d = report.data;
    if (!d) return null;
    switch (d.kind) {
      case 'profit-loss':
        return [
          ['Section', 'Group', 'Account', 'Amount'],
          ...d.rows.map((r) => [r.section, r.group_name, r.account_name ?? '', r.amount]),
        ];
      case 'balance-sheet':
        return [
          ['Group', 'Account', 'Closing Balance', 'Nature'],
          ...d.rows.map((r) => [r.group_name, r.account_name ?? '', r.closing_balance, r.nature]),
        ];
      case 'cash-flow':
        return [
          ['Date', 'Inflow', 'Outflow'],
          ...d.daily.map((x) => [x.flow_date, x.inflow, x.outflow]),
        ];
      case 'day-book':
        return [
          ['Date', 'Type', 'Doc #', 'Party', 'Description', 'Debit A/c', 'Credit A/c', 'Amount'],
          ...d.entries.map((e) => [
            e.entry_date, e.doc_type, e.doc_number, e.party_name ?? '', e.description ?? '', e.debit_ledger, e.credit_ledger, e.amount,
          ]),
        ];
      case 'ar-ap-aging':
        return [
          ['Party', 'Document', 'Doc Date', 'Due Date', 'Current', '1-30', '31-60', '61-90', '90+', 'Outstanding'],
          ...d.rows.map((r) => [
            r.party_name, r.doc_number, r.doc_date, r.due_date, r.current, r.days_1_30, r.days_31_60, r.days_61_90, r.days_90_plus, r.outstanding,
          ]),
        ];
      case 'party-ledger':
        return [
          ['Date', 'Type', 'Doc #', 'Description', 'Debit', 'Credit', 'Running Balance'],
          ...d.entries.map((e) => [e.entry_date, e.doc_type, e.doc_number, e.description ?? '', e.debit_amount, e.credit_amount, e.running_balance]),
        ];
      case 'gst-summary':
        return [
          ['Section', 'Ledger', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Net'],
          ...d.rows.map((r) => [r.section, r.ledger_name, r.taxable_amount, r.cgst, r.sgst, r.igst, r.cess, r.net_amount]),
        ];
      case 'sales-register':
      case 'purchase-register':
        return [
          ['Date', 'Document', 'Party', 'Taxable', 'CGST', 'SGST', 'IGST', 'Grand Total', 'Payment Status'],
          ...d.rows.map((r) => [r.doc_date, r.doc_number, r.party_name, r.taxable_amount, r.cgst_amount, r.sgst_amount, r.igst_amount, r.grand_total, r.payment_status]),
          ['TOTAL', '', '', d.totals.taxable, d.totals.cgst, d.totals.sgst, d.totals.igst, d.totals.grand, `${d.totals.count} documents`],
        ];
      case 'receivables':
      case 'payables':
        return [
          ['Party', 'Document', 'Doc Date', 'Due Date', 'Billed', 'Paid', 'Outstanding', 'Ageing'],
          ...d.rows.map((r) => [r.party_name, r.doc_number, r.doc_date, r.due_date, r.grand_total, r.paid_amount, r.outstanding, r.bucket]),
          ['TOTAL', '', '', '', d.totals.billed, d.totals.paid, d.totals.outstanding, `${d.totals.count} documents`],
        ];
      case 'cash-bank':
        return [
          ['Ledger', 'Opening', 'Inflow', 'Outflow', 'Net', 'Closing'],
          ...d.rows.map((r) => [r.ledger_name, r.opening, r.inflow, r.outflow, r.net, r.closing]),
          ['TOTAL', d.totals.opening, d.totals.inflow, d.totals.outflow, d.totals.inflow - d.totals.outflow, d.totals.closing],
        ];
      case 'gstr-1':
        return [
          ['Section', 'Invoice No', 'Date', 'Party', 'GSTIN', 'Place of Supply', 'Rate %', 'Items', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
          ...d.rows.map((r) => [r.section, r.doc_number, r.doc_date, r.party_name, r.party_gstin ?? '', r.place_of_supply ?? '', r.tax_rate, r.item_count, r.taxable_value, r.cgst, r.sgst, r.igst, r.cess]),
          ['TOTAL', '', '', '', '', '', '', '', d.totals.taxable, d.totals.cgst, d.totals.sgst, d.totals.igst, d.totals.cess],
        ];
      case 'gstr-3b':
        return [
          ['Section', 'Documents', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'],
          ['Outward supplies (3.1)', d.outward.doc_count ?? 0, d.outward.taxable_value, d.outward.igst, d.outward.cgst, d.outward.sgst, d.outward.cess],
          ['Input tax credit (4A)', d.inward.doc_count ?? 0, d.inward.taxable_value, d.inward.igst, d.inward.cgst, d.inward.sgst, d.inward.cess],
          [d.credit_carryforward ? 'Credit carry-forward' : 'Net tax payable', '', '', '', '', '', Math.abs(d.net)],
        ];
      case 'expense-report':
        return [
          ['Date', 'Expense #', 'Category', 'Description', 'Reference', 'Method', 'Net', 'Tax', 'Total'],
          ...d.rows.map((r) => [r.expense_date, r.expense_number, r.category_name, r.description ?? '', r.reference ?? '', r.payment_method ?? '', r.net_amount, r.tax_amount, r.total_amount]),
          ['TOTAL', '', '', '', '', '', d.totals.net, d.totals.tax, d.totals.total],
        ];
      case 'stock-report': {
        const matrix: (string | number)[][] = [
          ['Product', 'Quantity', 'Avg Cost', 'Value'],
          ...d.valuation.map((v) => [v.product_name, v.quantity, v.avg_cost, v.total_value]),
        ];
        matrix.push(['', '', '', '']);
        matrix.push(['Date', 'Product', 'Warehouse', 'Type', 'Quantity', 'Balance After', 'Unit Cost', 'Notes']);
        for (const m of d.movements) {
          matrix.push([m.created_at.slice(0, 10), m.product?.name ?? m.product_id, m.warehouse?.name ?? '-', m.type, m.quantity, m.balance_after, m.unit_cost ?? '', m.notes ?? '']);
        }
        return matrix;
      }
    }
  };

  const hasRows =
    !!report.data &&
    (('rows' in report.data && report.data.rows.length > 0) ||
      ('daily' in report.data && report.data.daily.length > 0) ||
      ('entries' in report.data && report.data.entries.length > 0) ||
      ('outward' in report.data && (report.data.outward?.doc_count ?? 0) + (report.data.inward?.doc_count ?? 0) > 0) ||
      ('valuation' in report.data &&
        (report.data.valuation.length > 0 || report.data.movements.length > 0)));

  const handleExport = () => {
    const matrix = buildCsv();
    if (matrix) downloadCsv(`${meta.id}_${range.from}_${range.to}.csv`, matrix);
  };

  const canShareLedger =
    meta.id === 'party-ledger' && statementSide === 'customer' && report.data?.kind === 'party-ledger';

  const handleShareLedger = () => {
    if (!canShareLedger || report.data?.kind !== 'party-ledger') return;
    const partyName = parties.data?.find((p) => p.id === partyId)?.name ?? '';
    const opened = openWhatsAppShare({
      partyName,
      docNumber: 'STATEMENT',
      dateDDMMYYYY: formatDate(range.to),
      amountInr: formatCurrency(report.data.closing, activeBusiness?.currency_symbol || '\u20B9'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
    });
    if (!opened) toast('Could not open WhatsApp — allow popups and try again', 'error');
  };

  const renderBody = () => {
    if (meta.status === 'wiring') {
      return (
        <ErrorState
          title="Report engine wiring in progress"
          message={`The data layer for ${meta.title} (${meta.binding}) is not available yet. No figures are shown because none are real yet.`}
        />
      );
    }
    if (report.isLoading) {
      return (
        <div className="animate-pulse space-y-3 p-6" aria-busy="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${88 - i * 9}%` }} />
          ))}
        </div>
      );
    }
    if (report.isError) {
      const notReady = report.error instanceof ReportNotReadyError;
      return (
        <ErrorState
          title={notReady ? 'Report engine wiring in progress' : 'Could not load report'}
          message={
            notReady
              ? `${meta.title} is not bound to the reporting core yet. Nothing fake is rendered meanwhile.`
              : 'Something went wrong querying the reporting core. Check your connection and retry.'
          }
          onRetry={notReady ? undefined : () => report.refetch()}
        />
      );
    }
    if (!report.data) return null;
    switch (report.data.kind) {
      case 'profit-loss':
        return <ProfitLossView data={report.data} />;
      case 'balance-sheet':
        return <BalanceSheetView data={report.data} />;
      case 'cash-flow':
        return <CashFlowView data={report.data} />;
      case 'day-book':
        return <DayBookView data={report.data} />;
      case 'ar-ap-aging':
        return <AgingView data={report.data} side={agingSide} onSideChange={setAgingSide} />;
      case 'party-ledger':
        return <PartyLedgerView data={report.data} />;
      case 'gst-summary':
        return <GstSummaryView data={report.data} />;
      case 'sales-register':
      case 'purchase-register':
        return <RegisterView data={report.data} />;
      case 'receivables':
      case 'payables':
        return <OutstandingView data={report.data} />;
      case 'cash-bank':
        return <CashBankView data={report.data} />;
      case 'gstr-1':
        return <Gstr1View data={report.data} />;
      case 'gstr-3b':
        return <Gstr3bView data={report.data} />;
      case 'expense-report':
        return <ExpenseReportView data={report.data} />;
      case 'stock-report':
        return <StockReportView data={report.data} />;
    }
  };

  return (
    <PageMotion>
      <div className="print:hidden">
        <Link
          to="/app/reports"
          className="inline-flex items-center gap-1.5 text-sm text-secondary-500 dark:text-secondary-400 hover:text-primary-600 dark:hover:text-primary-400 mb-2 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All reports
        </Link>
      </div>

      <PageHeader
        title={meta.title}
        subtitle={meta.description}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              {range.from} → {range.to}
            </span>
            {generatedAt && <span className="text-secondary-400">Generated {generatedAt}</span>}
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            {canShareLedger && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleShareLedger}
                disabled={!hasRows}
                title={hasRows ? 'Share this statement with the customer over WhatsApp' : 'Load the ledger first'}
              >
                <Share2 className="h-3.5 w-3.5" /> Share on WhatsApp
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={!hasRows} title={hasRows ? 'Download this table as CSV' : 'Nothing to export yet'}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { navigate('/app/settings'); toast('Tally XML export lives in Settings — Data & Backups', 'info'); }} title="Export for Tally import">
              <FileDown className="h-3.5 w-3.5" /> Tally
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSendChannel('email')} disabled={!hasRows} title={hasRows ? 'Email this report as an attachment' : 'Load the report first'}>
              <Send className="h-3.5 w-3.5" /> Email
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSendChannel('whatsapp')} disabled={!hasRows} title={hasRows ? 'Send this report over WhatsApp' : 'Load the report first'}>
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        }
      />

      <ReportDateRangeFilter value={range} onChange={setRange} className="mb-6 print:hidden" />

      {needsParty && (
        <div className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4 print:hidden">
          <div>
            <label className="label">Statement for</label>
            <Select value={statementSide} onChange={(e) => { setStatementSide(e.target.value as StatementSide); setPartyId(''); }}>
              <option value="customer">Customer</option>
              <option value="supplier">Supplier</option>
            </Select>
          </div>
          <div>
            <label className="label">Party</label>
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)} disabled={!parties.data || parties.data.length === 0}>
              {parties.isLoading && <option>Loading…</option>}
              {parties.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {parties.data && parties.data.length === 0 && <option value="">No active parties</option>}
            </Select>
          </div>
        </div>
      )}

      <section id="report-print-area" className="card" aria-live="polite">
        <div className="flex flex-wrap items-start gap-4 px-6 pt-5 pb-4 border-b border-secondary-100 dark:border-secondary-800">
          <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-2 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-indigo-500/25 print:hidden">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary-400">
              {activeBusiness?.name || 'Business'}
            </p>
            <h2 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100 leading-tight mt-0.5">
              {meta.title}
            </h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-secondary-500 dark:text-secondary-400">
              {activeBusiness?.gst_registered && activeBusiness?.gstin && (
                <span className="figure">GSTIN {activeBusiness.gstin}</span>
              )}
              {activeBusiness?.city && (
                <span>
                  {activeBusiness.city}
                  {activeBusiness.state ? `, ${activeBusiness.state}` : ''}
                </span>
              )}
              <span className="figure">
                Period {range.from} → {range.to}
              </span>
              {generatedAt && <span className="figure">Generated {generatedAt}</span>}
            </div>
          </div>
        </div>
        <div className="p-6">{renderBody()}</div>
        <div className="hidden print:flex items-center justify-between border-t border-secondary-200 px-6 py-3 text-[10px] text-secondary-400">
          <span className="figure truncate">
            {activeBusiness?.name || 'Business'} · {meta.title} · Period {range.from} → {range.to}
          </span>
          <span>Generated with AccountX</span>
        </div>
      </section>

      {AI_REPORT_IDS.has(meta.id) && meta.status !== 'wiring' && (
        <section className="card p-5 mt-6 print:hidden" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <Button
              size="sm"
              loading={ai.status === 'loading'}
              disabled={!hasRows}
              title={hasRows ? 'Get an AI explanation of this report' : 'Load the report first'}
              onClick={() =>
                ai.ask(
                  `Explain this ${meta.title} for ${range.from} → ${range.to}: what stands out, the key drivers behind the figures, and anything concerning.`,
                  { mode: 'report', reportId: meta.id }
                )
              }
            >
              <Sparkles className="h-3.5 w-3.5" /> Explain with AI
            </Button>
            <p className="text-xs text-secondary-400">
              Read-only explanation generated from this business's real data.
            </p>
          </div>

          {ai.status === 'loading' && (
            <div className="mt-4 space-y-2 animate-pulse" aria-busy="true">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-3.5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${90 - i * 12}%` }} />
              ))}
            </div>
          )}

          {ai.status === 'ready' && ai.result?.ok && (
            <div className="mt-4 pt-4 border-t border-secondary-100 dark:border-secondary-800">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="info">AI-generated insight</Badge>
                <span className="text-[10px] text-secondary-400 figure truncate">
                  {meta.title} · {range.from} → {range.to}
                  {ai.result.provider ? ` · ${ai.result.provider}` : ''}
                  {ai.result.model ? ` ${ai.result.model}` : ''}
                </span>
              </div>
              <p className="text-sm text-secondary-700 dark:text-secondary-300 whitespace-pre-wrap leading-relaxed">
                {ai.result.answer}
              </p>
              {ai.result.sources.length > 0 && (
                <p className="mt-2 text-[11px] text-secondary-400">
                  Sources: {ai.result.sources.map((s) => s.name).join(', ')}
                </p>
              )}
            </div>
          )}

          {ai.status === 'error' && ai.result && !ai.result.ok && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-3 print:hidden">
              <AlertCircle className="h-4 w-4 text-warning-500 shrink-0 mt-0.5" />
              <p className="text-sm text-secondary-700 dark:text-secondary-300">{ai.result.message}</p>
            </div>
          )}
        </section>
      )}

      <SendDialog
        open={sendChannel !== null}
        onClose={() => setSendChannel(null)}
        contextLabel={meta?.title ?? 'Report'}
        docType="report"
        docNumber={meta?.id}
        templateKey="report_delivery"
        templateVariables={{
          report_name: meta?.title ?? '',
          generated_at: generatedAt,
          format: sendChannel === 'whatsapp' ? 'text' : 'pdf',
        }}
        defaultSubject={`${meta?.title ?? 'Report'} · ${range.from} → ${range.to}`}
        defaultMessage={`Report ${meta?.title ?? ''} for ${range.from} → ${range.to} is attached. Generated from live business data at ${generatedAt}.`}
        recipients={[]}
        attachments={[
          ...(sendChannel === 'email'
            ? [
                {
                  id: 'report-pdf',
                  label: `${meta?.title ?? 'Report'} PDF (as printed)`,
                  filename: `${meta?.id ?? 'report'}_${range.from}_${range.to}.pdf`,
                  build: async () => {
                    const el = document.getElementById('report-print-area');
                    if (!el) throw new Error('The report is not rendered yet.');
                    return captureElementToPdfBlob(el);
                  },
                },
              ]
            : []),
          {
            id: 'report-csv',
            label: `${meta?.title ?? 'Report'} data (CSV)`,
            filename: `${meta?.id ?? 'report'}_${range.from}_${range.to}.csv`,
            build: async () => {
              const matrix = buildCsv();
              if (!matrix) throw new Error('Nothing to attach yet — load the report first.');
              const escapeCell = (cell: string | number) => {
                const s = String(cell ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
              };
              const csv = matrix.map((row) => row.map(escapeCell).join(',')).join('\n');
              return new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
            },
          },
        ]}
      />
    </PageMotion>
  );
}

/* ============================================================================
 * Reporting-completion views (sales/purchase registers, AR/AP detail,
 * Cash & Bank movements). Same visual grammar as the existing families.
 * ==========================================================================*/

function RegisterView({
  data,
}: {
  data: Extract<ReportData, { kind: 'sales-register' | 'purchase-register' }>;
}) {
  const isSales = data.kind === 'sales-register';
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={isSales ? FileText : ShoppingBag}
        title={isSales ? 'No sales in this period' : 'No purchases in this period'}
        description={
          isSales
            ? 'Issued invoices will appear here with their GST split once recorded.'
            : 'Confirmed bills will appear here with their GST split once recorded.'
        }
      />
    );
  const t = data.totals;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Document</Th>
            <Th>{isSales ? 'Customer' : 'Supplier'}</Th>
            <Th right>Taxable</Th>
            <Th right>CGST</Th>
            <Th right>SGST</Th>
            <Th right>IGST</Th>
            <Th right>Grand Total</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.doc_number}`} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40">
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
              <td className="figure px-3 py-2 whitespace-nowrap font-medium text-secondary-900 dark:text-secondary-100">{r.doc_number}</td>
              <td className="px-3 py-2 text-secondary-800 dark:text-secondary-200">{r.party_name}</td>
              <TdNum>{r.taxable_amount}</TdNum>
              <TdNum>{r.cgst_amount || ''}</TdNum>
              <TdNum>{r.sgst_amount || ''}</TdNum>
              <TdNum>{r.igst_amount || ''}</TdNum>
              <TdNum emphasis>{r.grand_total}</TdNum>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                    r.payment_status === 'paid'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : r.payment_status === 'partial'
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                        : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300'
                  )}
                >
                  {r.payment_status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={3}>
              Total ({t.count} {t.count === 1 ? 'document' : 'documents'})
            </td>
            <TdNum emphasis>{Math.round(t.taxable * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.cgst * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.sgst * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.igst * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.grand * 100) / 100}</TdNum>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const OUTSTANDING_BUCKETS: Array<{ key: OutstandingRow['bucket']; label: string }> = [
  { key: 'current', label: 'Current' },
  { key: '1-30', label: '1-30' },
  { key: '31-60', label: '31-60' },
  { key: '61-90', label: '61-90' },
  { key: '90+', label: '90+' },
];

function OutstandingView({
  data,
}: {
  data: Extract<ReportData, { kind: 'receivables' | 'payables' }>;
}) {
  const isAr = data.kind === 'receivables';
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={HandCoins}
        title={isAr ? 'No receivables outstanding' : 'No payables outstanding'}
        description={
          isAr
            ? 'Open customer invoices appear here with ageing from their due date.'
            : 'Open supplier bills appear here with ageing from their due date.'
        }
      />
    );
  const t = data.totals;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>{isAr ? 'Customer' : 'Supplier'}</Th>
            <Th>Document</Th>
            <Th>Doc Date</Th>
            <Th>Due Date</Th>
            <Th right>Billed</Th>
            <Th right>Paid</Th>
            <Th right>Outstanding</Th>
            <Th right>Ageing</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.doc_id} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40">
              <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">{r.party_name}</td>
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-600 dark:text-secondary-400">{r.doc_number}</td>
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
              <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.due_date}</td>
              <TdNum>{r.grand_total}</TdNum>
              <TdNum>{r.paid_amount || ''}</TdNum>
              <TdNum emphasis>{r.outstanding}</TdNum>
              <TdNum
                className={
                  r.bucket === '90+'
                    ? 'text-error-600 dark:text-error-400 font-semibold'
                    : r.bucket === '61-90'
                      ? 'text-amber-600 dark:text-amber-400'
                      : ''
                }
              >
                {r.bucket}
              </TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={4}>
              Total ({t.count} {t.count === 1 ? 'document' : 'documents'})
            </td>
            <TdNum emphasis>{Math.round(t.billed * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.paid * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.outstanding * 100) / 100}</TdNum>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CashBankView({ data }: { data: Extract<ReportData, { kind: 'cash-bank' }> }) {
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={Banknote}
        title="No cash or bank activity"
        description="Posted journal lines touching cash/bank ledgers will appear here."
      />
    );
  const t = data.totals;
  return (
    <div>
      <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4 print:hidden">
        Built from posted journal lines on accounts in the Cash &amp; Bank group - the same entries the ledger keeps, so opening and closing reconcile with the books.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Ledger</Th>
            <Th right>Opening</Th>
            <Th right>Inflow</Th>
            <Th right>Outflow</Th>
            <Th right>Net</Th>
            <Th right>Closing</Th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.ledger_name} className="border-b border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40">
              <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">{r.ledger_name}</td>
              <TdNum>{r.opening}</TdNum>
              <TdNum className="text-emerald-600 dark:text-emerald-400">{r.inflow || ''}</TdNum>
              <TdNum className="text-error-600 dark:text-error-400">{r.outflow || ''}</TdNum>
              <TdNum emphasis>{r.net}</TdNum>
              <TdNum>{r.closing}</TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-secondary-300 dark:border-secondary-600 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold">All cash &amp; bank ledgers</td>
            <TdNum emphasis>{Math.round(t.opening * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.inflow * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.outflow * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round((t.inflow - t.outflow) * 100) / 100}</TdNum>
            <TdNum emphasis>{Math.round(t.closing * 100) / 100}</TdNum>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Gstr1View({ data }: { data: Extract<ReportData, { kind: 'gstr-1' }> }) {
  if (data.rows.length === 0)
    return (
      <EmptyState
        icon={ReceiptText}
        title="No outward supplies"
        description="Issued invoices with GST in this period will appear here, B2B and B2C."
      />
    );
  const t = data.totals;
  const b2b = data.rows.filter((r) => r.section === 'B2B');
  const b2c = data.rows.filter((r) => r.section === 'B2C');
  const rateRow = (r: typeof data.rows[number]) => (
    <tr key={`${r.invoice_id}-${r.tax_rate}`} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
      <td className="figure px-3 py-1.5 whitespace-nowrap">{r.doc_number}</td>
      <td className="figure px-3 py-1.5 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
      <td className="px-3 py-1.5 text-secondary-700 dark:text-secondary-300 max-w-[12rem] truncate">{r.party_name || '—'}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">{r.party_gstin ?? '—'}</td>
      <td className="px-3 py-1.5 text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">{r.place_of_supply ?? '—'}</td>
      <TdNum>{r.tax_rate}</TdNum>
      <TdNum>{formatCurrency(r.taxable_value)}</TdNum>
      <TdNum>{r.cgst ? formatCurrency(r.cgst) : '—'}</TdNum>
      <TdNum>{r.sgst ? formatCurrency(r.sgst) : '—'}</TdNum>
      <TdNum>{r.igst ? formatCurrency(r.igst) : '—'}</TdNum>
      <TdNum>{r.cess ? formatCurrency(r.cess) : '—'}</TdNum>
    </tr>
  );
  const sectionTable = (rows: typeof data.rows) => {
    const docs = summarizeGstr1Docs(rows);
    return (
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Invoice No</Th>
            <Th>Date</Th>
            <Th>Party</Th>
            <Th>GSTIN</Th>
            <Th>Place of Supply</Th>
            <Th right>Rate %</Th>
            <Th right>Taxable</Th>
            <Th right>CGST</Th>
            <Th right>SGST</Th>
            <Th right>IGST</Th>
            <Th right>Cess</Th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <Fragment key={d.invoice_id}>
              {rows.filter((r) => r.invoice_id === d.invoice_id).map(rateRow)}
              <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50/70 dark:bg-secondary-800/40 break-inside-avoid">
                <td className="px-3 py-1 text-xs font-semibold text-secondary-600 dark:text-secondary-300" colSpan={5}>
                  {d.doc_number} total · {d.rates.length > 1 ? `rates ${d.rates.join(' / ')}%` : `${d.rates[0]}%`}
                </td>
                <td />
                <TdNum className="text-xs font-semibold">{formatCurrency(d.taxable)}</TdNum>
                <TdNum className="text-xs font-semibold">{d.cgst ? formatCurrency(d.cgst) : '—'}</TdNum>
                <TdNum className="text-xs font-semibold">{d.sgst ? formatCurrency(d.sgst) : '—'}</TdNum>
                <TdNum className="text-xs font-semibold">{d.igst ? formatCurrency(d.igst) : '—'}</TdNum>
                <TdNum className="text-xs font-semibold">{d.cess ? formatCurrency(d.cess) : '—'}</TdNum>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    );
  };
  return (
    <div className="space-y-6">
      <p className="text-xs text-secondary-500 dark:text-secondary-400 print:hidden">
        Document-basis statement over v_gstr1_outward (issued invoices as stored, one line per tax rate) — this can legitimately differ
        from the journal-basis GST Summary around credit/debit notes and settlement timing. Information only; nothing is submitted
        to the portal from AccountX.
      </p>
      <section className="print-section">
        <BandRow label={`B2B — registered buyers (${t.b2b_docs} documents)`} colSpan={11} />
        {b2b.length > 0 ? sectionTable(b2b) : (
          <p className="text-xs text-secondary-400 px-3 py-3">No B2B lines — add GSTINs to customers to classify invoices as B2B.</p>
        )}
      </section>
      <section className="print-section">
        <BandRow label={`B2C — unregistered buyers (${t.b2c_docs} documents)`} colSpan={11} />
        {b2c.length > 0 ? sectionTable(b2c) : (
          <p className="text-xs text-secondary-400 px-3 py-3">No B2C lines.</p>
        )}
      </section>
      <table className="w-full text-sm">
        <tfoot>
          <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={6}>Total outward tax</td>
            <TdNum emphasis>{formatCurrency(t.taxable)}</TdNum>
            <TdNum emphasis>{formatCurrency(t.cgst)}</TdNum>
            <TdNum emphasis>{formatCurrency(t.sgst)}</TdNum>
            <TdNum emphasis>{formatCurrency(t.igst)}</TdNum>
            <TdNum emphasis>{formatCurrency(t.cess)}</TdNum>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Gstr3bView({ data }: { data: Extract<ReportData, { kind: 'gstr-3b' }> }) {
  const rows: { label: string; s: typeof data.outward }[] = [
    { label: 'Outward supplies & liable inward (3.1)', s: data.outward },
    { label: 'Eligible input tax credit (4A)', s: data.inward },
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-secondary-500 dark:text-secondary-400 print:hidden">
        Document-basis summary (get_gstr_doc_summary: issued invoices / confirmed bills) — may differ from the journal-basis GST Summary
        around CN/DN issuance and settlement timing. Information only, not a filing.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <Th>Particulars</Th>
            <Th right>Documents</Th>
            <Th right>Taxable</Th>
            <Th right>IGST</Th>
            <Th right>CGST</Th>
            <Th right>SGST</Th>
            <Th right>Cess</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
              <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">{r.label}</td>
              <TdNum>{r.s.doc_count ?? 0}</TdNum>
              <TdNum>{formatCurrency(r.s.taxable_value)}</TdNum>
              <TdNum>{formatCurrency(r.s.igst)}</TdNum>
              <TdNum>{formatCurrency(r.s.cgst)}</TdNum>
              <TdNum>{formatCurrency(r.s.sgst)}</TdNum>
              <TdNum>{formatCurrency(r.s.cess)}</TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={6}>
              {data.credit_carryforward ? 'Credit carry-forward (nothing payable)' : 'Net tax payable'}
            </td>
            <TdNum emphasis>{formatCurrency(Math.abs(data.net))}</TdNum>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
