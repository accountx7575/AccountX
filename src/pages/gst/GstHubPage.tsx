import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileSpreadsheet,
  ScrollText,
  ShieldCheck,
  GitCompareArrows,
  Landmark,
  ArrowRight,
  ReceiptText,
  FileMinus,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { GstTaxMatrix } from '@/components/gst/GstTaxMatrix';
import { getGstDashboard, type GstDashboardPayload } from '@/components/gst/gstApi';
import { resolvePreset, fetchGstSummary, type DateRange } from '@/lib/reportsAdapter';
import { formatCurrency } from '@/lib/utils';

/* ============================================================================
 * /app/gst - GST Compliance hub (T103 bind phase).
 * KPIs + tiles = ONE call to get_gst_dashboard (058, document-truth):
 * output/input/net per component, B2B/B2C splits, CN/DN counts,
 * zero-rated exports, open validation issue counts.
 * The journal-truth matrix card is RETAINED beneath (get_gst_summary, 025)
 * so both bases stay visible and labelled - they legitimately diverge
 * around CN/DN issuance and settlement timing.
 * ==========================================================================*/

const NAV_TILES = [
  { to: '/app/gst/gstr-1', icon: FileSpreadsheet, title: 'GSTR-1', desc: 'B2B/B2C rate-lines, credit-debit notes, nil/exempt and HSN summary.' },
  { to: '/app/gst/gstr-3b', icon: ScrollText, title: 'GSTR-3B', desc: 'Computed outward tax, CDNR adjustments, ITC and net position with a local-only draft worksheet.' },
  { to: '/app/gst/validation', icon: ShieldCheck, title: 'Validation Center', desc: 'Doc-level GST checks: GSTIN format, PoS/HSN presence, tax-mode conflicts, totals identity - with suggested fixes.' },
  { to: '/app/gst/reconciliation', icon: GitCompareArrows, title: 'Reconciliation', desc: 'Per-document document-truth tax vs posted journal GST ledgers, diff list and coverage gaps.' },
];

export function GstHubPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;
  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));

  const dash = useQuery({
    queryKey: ['gst-dashboard', businessId, range.from, range.to],
    queryFn: () => getGstDashboard(businessId!, range.from, range.to),
    enabled: !!businessId,
  });

  // Journal-truth companion card (basis contrast).
  const summary = useQuery({
    queryKey: ['gst-hub-summary', businessId, range.from, range.to],
    queryFn: () => fetchGstSummary({ businessId: businessId!, range }),
    enabled: !!businessId,
  });

  const d = dash.data ?? null;
  const gstReady = activeBusiness?.gst_registered && !!activeBusiness?.gstin;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST Compliance"
        subtitle="Your GST position year-round - computed from live documents and posted books. Information only; nothing is filed from AccountX."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant={gstReady ? 'success' : 'warning'}>
              {gstReady ? `GSTIN ${activeBusiness?.gstin}` : 'Not GST-registered'}
            </Badge>
            {!gstReady && (
              <Link to="/app/settings" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                Add GSTIN in Settings →
              </Link>
            )}
          </span>
        }
      />

      <ReportDateRangeFilter value={range} onChange={setRange} className="print:hidden" />

      {(dash.isError || summary.isError) && (
        <ErrorState
          title="Could not load GST data"
          message="Something went wrong querying the GST engines. Check your connection and retry."
          onRetry={() => {
            if (dash.isError) dash.refetch();
            if (summary.isError) summary.refetch();
          }}
        />
      )}

      {/* KPI cards - document truth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Taxable turnover"
          value={d ? <span className="figure">{formatCurrency(d.output.taxable_value)}</span> : '—'}
          hint="Outward supplies in the period (document basis)"
          icon={Landmark}
          tone="cash"
          footer={<span className="text-caption">{d?.output.doc_count ?? 0} invoices · document-truth</span>}
        />
        <StatCard
          label="Output tax"
          value={d ? <span className="figure">{formatCurrency(d.output.total_tax)}</span> : '—'}
          hint="CGST + SGST + IGST + Cess on outward supplies"
          icon={ReceiptText}
          tone="inflow"
          footer={<span className="text-caption">Document-truth</span>}
        />
        <StatCard
          label="Input tax credit"
          value={d ? <span className="figure">{formatCurrency(d.input.total_tax)}</span> : '—'}
          hint="Tax on confirmed inward supplies available for set-off"
          icon={FileMinus}
          tone="outflow"
          footer={<span className="text-caption">{d?.input.doc_count ?? 0} bills · document-truth</span>}
        />
        <StatCard
          label={d && d.net.total < 0 ? 'Credit carry-forward' : 'Net position'}
          value={d ? <span className="figure">{formatCurrency(Math.abs(d.net.total))}</span> : '—'}
          hint="Output tax minus input tax credit"
          icon={TriangleAlert}
          tone="warn"
          footer={
            <Badge variant={d && d.net.total < 0 ? 'success' : 'neutral'}>
              {d ? (d.net.total < 0 ? 'Nothing payable' : 'Payable to government') : '—'}
            </Badge>
          }
        />
      </div>

      {/* Document-truth split tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <TileStat label="B2B documents" value={d ? String(d.b2b.doc_count) : null} loading={dash.isLoading} footer={`${formatCurrency(d?.b2b.taxable_value ?? 0)} taxable`} />
        <TileStat label="B2C documents" value={d ? String(d.b2c.doc_count) : null} loading={dash.isLoading} footer={`${formatCurrency(d?.b2c.taxable_value ?? 0)} taxable`} />
        <TileStat
          label="Credit / Debit notes"
          value={d ? `${d.credit_notes.count} / ${d.debit_notes.count}` : null}
          loading={dash.isLoading}
          footer={`CN decrease output · DN increase output`}
        />
        <div className="card stat-glow p-5 flex flex-col gap-2">
          <p className="text-caption font-medium uppercase tracking-[0.06em]">Validation issues</p>
          {d ? (
            d.open_validation_issues.total === 0 ? (
              <Badge variant="success">All checks passed</Badge>
            ) : (
              <Link to="/app/gst/validation" className="flex flex-wrap items-center gap-1.5 group">
                <Badge variant="error">{d.open_validation_issues.critical} critical</Badge>
                <Badge variant="warning">{d.open_validation_issues.warning} warning</Badge>
                <Badge variant="neutral">{d.open_validation_issues.info} info</Badge>
              </Link>
            )
          ) : (
            <span className="figure font-semibold text-xl text-zinc-900 dark:text-zinc-100">…</span>
          )}
          <Link to="/app/gst/validation" className="text-caption mt-auto hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
            Open Validation Center →
          </Link>
        </div>
      </div>

      {/* Journal-truth matrix card */}
      <section id="report-print-area" className="card p-6" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100">GST Summary (posted books)</h2>
          <div className="flex items-center gap-2">
            <Badge variant="info">Journal-truth</Badge>
            <Link to="/app/reports/gst-summary" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline print:hidden">
              Ledger-level detail <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
        {summary.isLoading ? (
          <SkeletonBlock />
        ) : summary.data ? (
          <GstTaxMatrix rows={summary.data.rows} />
        ) : null}
      </section>

      {/* Navigation tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {NAV_TILES.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.to} to={t.to} className="card p-5 flex items-start gap-4 group hover:border-primary-500/40 transition-colors">
              <div className="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-2 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-indigo-500/25 shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-secondary-900 dark:text-secondary-100">{t.title}</p>
                <p className="text-sm text-secondary-500 dark:text-secondary-400 mt-0.5">{t.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-secondary-300 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all mt-1 shrink-0" />
            </Link>
          );
        })}
      </div>

      {/* zero-rated honesty footnote when present */}
      {d && d.zero_rated_exports.doc_count > 0 && (
        <p className="text-xs text-secondary-400 -mt-2">
          Includes {d.zero_rated_exports.doc_count} zero-rated export document(s) ({formatCurrency(d.zero_rated_exports.taxable_value)} taxable) carrying no GST by definition.
        </p>
      )}
    </div>
  );
}

function TileStat({
  label,
  value,
  loading,
  footer,
}: {
  label: string;
  value: string | null;
  loading?: boolean;
  footer?: string;
}) {
  return (
    <div className="card stat-glow p-5 flex flex-col gap-2">
      <p className="text-caption font-medium uppercase tracking-[0.06em]">{label}</p>
      <span className="figure font-semibold text-xl tabular-nums text-zinc-900 dark:text-zinc-100">
        {loading ? '…' : (value ?? '—')}
      </span>
      {footer && <p className="text-caption mt-auto">{footer}</p>}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="animate-pulse space-y-3 py-2" aria-busy="true">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${88 - i * 9}%` }} />
      ))}
    </div>
  );
}

/* keep tree-shaking honest: payload type re-export for consumers */
export type { GstDashboardPayload };
