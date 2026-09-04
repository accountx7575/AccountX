import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { cn } from '@/lib/utils';
import { resolvePreset, type DateRange } from '@/lib/reportsAdapter';
import { getGstValidationIssues, type GstValidationIssue, type ValidationSeverity } from '@/components/gst/gstApi';

/* ============================================================================
 * /app/gst/validation (T103 bind phase) - LIVE over get_gst_validation_issues
 * (055). Read-only engine: one row per finding with severity, doc coordinates,
 * machine-readable code, human problem text and suggested_fix. Issues whose
 * document has a detail route deep-link into it; others render the doc number
 * plainly (purchase bills have no detail route yet - honest limitation).
 * ==========================================================================*/

const GROUPS: Array<{ severity: ValidationSeverity; title: string; blurb: string }> = [
  { severity: 'critical', title: 'Critical', blurb: 'Would misstate a GST return - fix before filing.' },
  { severity: 'warning', title: 'Warning', blurb: 'Reduces input credit or invites notices.' },
  { severity: 'info', title: 'Info · excluded from reports', blurb: 'Draft/cancelled documents inside the period that reports skip.' },
];

const SEVERITY_BADGE: Record<ValidationSeverity, 'error' | 'warning' | 'neutral'> = {
  critical: 'error',
  warning: 'warning',
  info: 'neutral',
};

export function GstValidationPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id;

  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));

  const report = useQuery({
    queryKey: ['gst-validation', businessId, range.from, range.to],
    queryFn: () => getGstValidationIssues(businessId!, range.from, range.to),
    enabled: !!businessId,
  });

  const issues = report.data ?? [];
  const counts = useMemo(
    () => ({
      critical: issues.filter((i) => i.severity === 'critical').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    }),
    [issues]
  );

  const openDoc = (issue: GstValidationIssue) => {
    if (issue.doc_type === 'sales_invoice' && issue.doc_id) navigate(`/app/sales-invoices/${issue.doc_id}`);
    // purchase bills have no detail route yet - no navigation, honest noop.
  };

  const exportCsv = () => {
    const escapeCell = (cell: string | number) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const matrix: (string | number)[][] = [
      ['Severity', 'Code', 'Doc Type', 'Doc Number', 'Doc Date', 'Party', 'Problem', 'Suggested Fix'],
      ...issues.map((i) => [i.severity, i.code, i.doc_type, i.doc_number ?? '', i.doc_date ?? '', i.party ?? '', i.problem, i.suggested_fix ?? '']),
    ];
    const csv = matrix.map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gst-validation_${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Validation Center"
        subtitle="Document-level GST data-quality checks across the period. Read-only engine - it never mutates your data."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="info">live engine</Badge>
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              {range.from} → {range.to}
            </span>
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={issues.length === 0}>
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
          title="Could not run validation"
          message="Something went wrong querying the validation engine. Check your connection and retry."
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

      {report.isSuccess && issues.length === 0 && (
        <section className="card p-10 flex flex-col items-center text-center gap-3">
          <ShieldCheck className="h-10 w-10 text-success-500" />
          <h2 className="font-bold text-lg text-secondary-900 dark:text-secondary-100">Every check passed</h2>
          <p className="text-sm text-secondary-500 dark:text-secondary-400 max-w-md">
            No GSTIN format problems, missing places of supply or HSNs, tax-mode conflicts, total mismatches or duplicate numbers were found
            in this period.
          </p>
        </section>
      )}

      {GROUPS.map((g) => {
        const rows = issues.filter((i) => i.severity === g.severity);
        if (rows.length === 0 && !report.isLoading) return null;
        return (
          <section key={g.severity} className="card p-6" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <Badge variant={SEVERITY_BADGE[g.severity]}>{g.title}</Badge>
              <span className="figure text-sm font-semibold text-secondary-900 dark:text-secondary-100">{rows.length}</span>
              <span className="text-xs text-secondary-400">{g.blurb}</span>
            </div>
            <div className="mt-3 overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['Document', 'Date', 'Party', 'Check', 'Problem', 'Suggested fix'].map((h, idx) => (
                      <th
                        key={h}
                        className={cn(
                          'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
                          h === 'Check' && 'w-40'
                        )}
                      >
                        {idx === 5 ? 'Suggested fix' : h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((i, idx) => (
                    <tr key={`${i.code}-${i.doc_id}-${idx}`} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid align-top hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {i.doc_type === 'sales_invoice' && i.doc_id ? (
                          <button
                            type="button"
                            onClick={() => openDoc(i)}
                            className="figure font-medium text-primary-600 dark:text-primary-400 hover:underline"
                            title="Open this invoice"
                          >
                            {i.doc_number}
                          </button>
                        ) : (
                          <span className="figure text-secondary-700 dark:text-secondary-300">{i.doc_number ?? '—'}</span>
                        )}
                        <span className="block text-[10px] uppercase tracking-wide text-secondary-400">{i.doc_type}</span>
                      </td>
                      <td className="figure px-3 py-2 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{i.doc_date ?? '—'}</td>
                      <td className="px-3 py-2 text-secondary-700 dark:text-secondary-300 max-w-[12rem] truncate">{i.party ?? '—'}</td>
                      <td className="px-3 py-2"><code className="rounded bg-secondary-100 dark:bg-secondary-800 px-1.5 py-0.5 text-[11px]">{i.code}</code></td>
                      <td className="px-3 py-2 text-secondary-700 dark:text-secondary-300 max-w-[22rem]">{i.problem}</td>
                      <td className="px-3 py-2 text-emerald-700 dark:text-emerald-400 max-w-[20rem]">{i.suggested_fix ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {counts.critical > 0 && (
        <p className="text-xs text-error-600 dark:text-error-400 print:hidden">
          {counts.critical} critical issue(s) would misstate a GST return. Fix these before relying on the GSTR pages for filing preparation.
        </p>
      )}
    </div>
  );
}
