import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, GitCompareArrows } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { cn, formatCurrency } from '@/lib/utils';
import { resolvePreset, type DateRange } from '@/lib/reportsAdapter';
import { getGstReconciliation, type ReconDocRow } from '@/components/gst/gstApi';

/* ============================================================================
 * /app/gst/reconciliation (T103 bind phase) - LIVE over get_gst_reconciliation
 * (056). Per live document: header tax (document truth) vs posted journal GST
 * ledger lines (journal truth), with match_status per engine:
 * matched | difference | unjournaled | multi_posted. CN/DN coverage is
 * aggregate-only by engine design - the boundary note is rendered verbatim.
 * ==========================================================================*/

type StatusFilter = 'problems' | 'all';

const STATUS_BADGE: Record<ReconDocRow['match_status'], 'success' | 'warning' | 'error' | 'neutral'> = {
  matched: 'success',
  difference: 'warning',
  unjournaled: 'error',
  multi_posted: 'error',
};

export function GstReconciliationPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id;

  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('problems');

  const report = useQuery({
    queryKey: ['gst-recon', businessId, range.from, range.to],
    queryFn: () => getGstReconciliation(businessId!, range.from, range.to),
    enabled: !!businessId,
  });

  const d = report.data;
  const rows = useMemo(() => {
    const all = d?.documents ?? [];
    return statusFilter === 'problems' ? all.filter((r) => r.match_status !== 'matched') : all;
  }, [d, statusFilter]);

  const exportCsv = () => {
    if (!d) return;
    const escapeCell = (cell: string | number) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const matrix: (string | number)[][] = [
      ['Status', 'Doc Type', 'Doc Number', 'Doc Date', 'Party', 'Direction', 'Doc CGST', 'JE CGST', 'Doc SGST', 'JE SGST', 'Doc IGST', 'JE IGST', 'Doc Tax Total', 'JE Tax Total', 'Diff (JE-Doc)', 'Unmapped Residual', 'JE Count'],
      ...d.documents.map((r) => [
        r.match_status, r.doc_type, r.doc_number, r.doc_date, r.party_name ?? '', r.direction,
        r.doc_cgst, r.je_cgst, r.doc_sgst, r.je_sgst, r.doc_igst, r.je_igst,
        r.doc_tax_total, r.je_tax_total, Math.round((r.je_tax_total - r.doc_tax_total) * 100) / 100,
        r.unmapped_residual, r.je_count,
      ]),
      [],
      ['Totals', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['docs_checked', d.totals.docs_checked],
      ['matched', d.totals.matched],
      ['with_difference', d.totals.with_difference],
      ['unjournaled', d.totals.unjournaled],
      ['multi_posted', d.totals.multi_posted],
      ['absolute_difference_sum', d.totals.absolute_difference_sum],
      ['unmapped_ledger_residual_sum', d.totals.unmapped_ledger_residual_sum],
    ];
    const csv = matrix.map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gst-reconciliation_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="GST Reconciliation"
        subtitle="What your documents say vs what your books posted, tax by tax. Read-only engine - it never mutates your data."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="info">{d?.basis ?? 'journal-vs-document'}</Badge>
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              {range.from} → {range.to}
            </span>
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!d || (d.documents.length === 0)}>
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        }
      />

      <ReportDateRangeFilter value={range} onChange={setRange} className="print:hidden" />

      {report.isError && (
        <ErrorState
          title="Could not run reconciliation"
          message="Something went wrong querying the reconciliation engine. Check your connection and retry."
          onRetry={() => report.refetch()}
        />
      )}

      {report.isLoading && (
        <section className="card p-6">
          <div className="animate-pulse space-y-3 py-2" aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${90 - i * 8}%` }} />
            ))}
          </div>
        </section>
      )}

      {d && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <MiniStat label="Docs checked" value={String(d.totals.docs_checked)} />
            <MiniStat label="Matched" value={String(d.totals.matched)} tone={d.totals.matched === d.totals.docs_checked ? 'success' : 'default'} />
            <MiniStat label="Differences" value={String(d.totals.with_difference)} tone={d.totals.with_difference > 0 ? 'warn' : 'default'} />
            <MiniStat label="Unjournaled" value={String(d.totals.unjournaled)} tone={d.totals.unjournaled > 0 ? 'warn' : 'default'} />
            <MiniStat label="Multi-posted" value={String(d.totals.multi_posted)} tone={d.totals.multi_posted > 0 ? 'danger' : 'default'} />
            <MiniStat label="Abs diff sum" value={formatCurrency(d.totals.absolute_difference_sum)} />
            <MiniStat label="Unmapped residual" value={formatCurrency(d.totals.unmapped_ledger_residual_sum)} hint="Tax posted to non-canonical GST ledgers - never silently dropped" />
          </div>

          {/* CN/DN aggregate coverage */}
          <section className="card p-5">
            <h2 className="font-semibold text-secondary-900 dark:text-secondary-100 mb-2">Credit / Debit note coverage (aggregate)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
              <CoverageLine label="Credit notes live in period" count={d.notes_coverage.credit_notes_live} jes={d.notes_coverage.credit_note_posted_jes} unit="posted JEs" />
              <CoverageLine label="Debit notes live in period" count={d.notes_coverage.debit_notes_live} jes={d.notes_coverage.debit_note_posted_jes} unit="posted JEs" />
            </div>
            <p className="mt-3 text-xs text-secondary-400 border-t border-secondary-100 dark:border-secondary-800 pt-2">{d.boundary_note}</p>
          </section>

          {/* Diff table */}
          <section id="report-print-area" className="card p-6" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2 mb-4 print:hidden">
              <GitCompareArrows className="h-4 w-4 text-secondary-400" />
              <h2 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100">Document vs journal</h2>
              <div className="ml-auto flex gap-2" role="radiogroup" aria-label="Row filter">
                {(['problems', 'all'] as StatusFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={statusFilter === f}
                    onClick={() => setStatusFilter(f)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      statusFilter === f
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                        : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400'
                    )}
                  >
                    {f === 'problems' ? 'Problems only' : 'All documents'}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyStateInline
                title={statusFilter === 'problems' ? 'No differences found' : 'No documents in this period'}
                description={
                  statusFilter === 'problems'
                    ? 'Every live invoice and bill reconciles with its posted journal within tolerance.'
                    : 'Live invoices and confirmed bills appear here once recorded.'
                }
              />
            ) : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['Status', 'Document', 'Date', 'Party', 'Doc tax', 'Journal tax', 'Diff (JE-Doc)', 'JEs'].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
                            i >= 4 ? 'text-right' : 'text-left'
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const diff = Math.round((r.je_tax_total - r.doc_tax_total) * 100) / 100;
                      const clickable = r.doc_type === 'sales_invoice';
                      return (
                        <tr
                          key={`${r.doc_type}-${r.doc_id}`}
                          onClick={() => clickable && navigate(`/app/sales-invoices/${r.doc_id}`)}
                          className={cn(
                            'border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid align-top',
                            clickable && 'cursor-pointer hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40 transition-colors'
                          )}
                        >
                          <td className="px-3 py-2"><Badge variant={STATUS_BADGE[r.match_status]}>{r.match_status.replace('_', ' ')}</Badge></td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={cn('figure font-medium', clickable ? 'text-primary-600 dark:text-primary-400' : '')}>{r.doc_number}</span>
                            <span className="block text-[10px] uppercase tracking-wide text-secondary-400">
                              {r.direction} · {r.doc_type}
                            </span>
                          </td>
                          <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
                          <td className="px-3 py-2 text-secondary-700 dark:text-secondary-300 max-w-[12rem] truncate">{r.party_name || '—'}</td>
                          <td className="figure px-3 py-2 text-right whitespace-nowrap">{formatCurrency(r.doc_tax_total)}</td>
                          <td className="figure px-3 py-2 text-right whitespace-nowrap">{formatCurrency(r.je_tax_total)}</td>
                          <td
                            className={cn(
                              'figure px-3 py-2 text-right whitespace-nowrap',
                              diff === 0 ? '' : diff > 0 ? 'text-warning-600 dark:text-warning-400 font-medium' : 'text-error-600 dark:text-error-400 font-medium'
                            )}
                          >
                            {diff === 0 ? '—' : formatCurrency(diff)}
                          </td>
                          <td className="figure px-3 py-2 text-right whitespace-nowrap">{r.je_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-secondary-400 print:hidden">
              Tolerance 0.01 absorbs display rounding only. Component-level splits (CGST/SGST/IGST doc vs journal) are included in the CSV export.
              Purchase bills have no detail page yet - their rows are not clickable.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone, hint }: { label: string; value: string; tone?: 'success' | 'warn' | 'danger' | 'default'; hint?: string }) {
  const color =
    tone === 'success'
      ? 'text-success-600 dark:text-success-400'
      : tone === 'warn'
        ? 'text-warning-600 dark:text-warning-400'
        : tone === 'danger'
          ? 'text-error-600 dark:text-error-400'
          : '';
  return (
    <div className="card p-4 flex flex-col gap-1" title={hint}>
      <p className="text-caption font-medium uppercase tracking-[0.06em]">{label}</p>
      <span className={cn('figure font-semibold text-lg tabular-nums', color || 'text-zinc-900 dark:text-zinc-100')}>{value}</span>
    </div>
  );
}

function CoverageLine({ label, count, jes, unit }: { label: string; count: number; jes: number; unit: string }) {
  const covered = count === jes;
  return (
    <p className="flex items-center justify-between gap-3 border-b border-secondary-100 dark:border-secondary-800 py-1">
      <span className="text-secondary-600 dark:text-secondary-400">{label}</span>
      <span className="figure whitespace-nowrap">
        {count} live · {jes} {unit}{' '}
        {!covered && <Badge variant="warning">unbalanced</Badge>}
        {covered && count === 0 && <Badge variant="neutral">none</Badge>}
      </span>
    </p>
  );
}

function EmptyStateInline({ title, description }: { title: string; description: string }) {
  return (
    <div className="py-10 text-center">
      <p className="font-semibold text-secondary-900 dark:text-secondary-100">{title}</p>
      <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-1">{description}</p>
    </div>
  );
}
