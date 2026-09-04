import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, Send, MessageCircle, RotateCcw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Tooltip } from '@/components/ui/Tooltip';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { SendDialog } from '@/components/comms/SendDialog';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import { cn, formatCurrency } from '@/lib/utils';
import { resolvePreset, type DateRange } from '@/lib/reportsAdapter';
import { getGstr3bComputed, type Gstr3bComputedPayload } from '@/components/gst/gstApi';

/* ============================================================================
 * /app/gst/gstr-3b (T103 bind phase).
 * "Calculated by AccountX" = verbatim get_gstr3b_computed (054/058):
 * outward 3.1(a), zero-rated exports (REAL via is_export since 057, with the
 * engine's note surfaced), nil/exempt, CDNR signed net adjustment, adjusted
 * output, ITC 4A, per-component net position w/ carry-forward flag.
 * The adjustment worksheet stays component-local: never persisted, never
 * presented as filed; reload discards it by design.
 * ==========================================================================*/

const ADJ_FIELDS = [
  { key: 'igst', label: 'IGST' },
  { key: 'cgst', label: 'CGST' },
  { key: 'sgst', label: 'SGST' },
  { key: 'cess', label: 'Cess' },
] as const;

type AdjKey = (typeof ADJ_FIELDS)[number]['key'];
type AdjState = Record<AdjKey, string>;

const EMPTY_ADJ: AdjState = { igst: '', cgst: '', sgst: '', cess: '' };

function num(v: string): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function Gstr3bPage() {
  const { activeBusiness } = useAuth();
  const businessId = activeBusiness?.id;

  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));
  const [outAdj, setOutAdj] = useState<AdjState>(EMPTY_ADJ);
  const [inAdj, setInAdj] = useState<AdjState>(EMPTY_ADJ);
  const [sendChannel, setSendChannel] = useState<'email' | 'whatsapp' | null>(null);

  const report = useQuery({
    queryKey: ['gst-gstr3b-computed', businessId, range.from, range.to],
    queryFn: () => getGstr3bComputed(businessId!, range.from, range.to),
    enabled: !!businessId,
  });

  const d = report.data;
  const hasRows = !!d && (d.outward_3_1a.doc_count + d.inward_itc_4a.bill_count) > 0;

  const anyAdj =
    Object.values(outAdj).some((v) => v !== '' && num(v) !== 0) ||
    Object.values(inAdj).some((v) => v !== '' && num(v) !== 0);

  const workingNet = useMemo(() => {
    if (!d) return null;
    const outDelta = ADJ_FIELDS.reduce((s, f) => s + num(outAdj[f.key]), 0);
    const inDelta = ADJ_FIELDS.reduce((s, f) => s + num(inAdj[f.key]), 0);
    return d.net_position.total_net_payable + outDelta - inDelta;
  }, [d, outAdj, inAdj]);

  const generatedAt = report.dataUpdatedAt ? new Date(report.dataUpdatedAt).toLocaleString() : '';

  const buildCsvMatrix = (p: Gstr3bComputedPayload): (string | number)[][] => [
    ['Basis', p.basis],
    [],
    ['Particulars', 'Documents', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
    ['Outward supplies & liable inward (3.1(a))', p.outward_3_1a.doc_count, p.outward_3_1a.taxable_value, p.outward_3_1a.cgst, p.outward_3_1a.sgst, p.outward_3_1a.igst, p.outward_3_1a.cess],
    ['Zero-rated exports', p.zero_rated.doc_count, p.zero_rated.taxable_value, 0, 0, 0, 0],
    ['Nil-rated / exempt outward', p.nil_other_outward.doc_count, p.nil_other_outward.taxable_value, '', '', '', ''],
    ['CDNR adjustment (DN minus CN)', `${p.cdnr_adjustment.credit_notes} CN / ${p.cdnr_adjustment.debit_notes} DN`, p.cdnr_adjustment.taxable_net_effect, p.cdnr_adjustment.cgst, p.cdnr_adjustment.sgst, p.cdnr_adjustment.igst, p.cdnr_adjustment.cess],
    ['Adjusted output tax', '', p.adjusted_output.taxable_value, p.adjusted_output.cgst, p.adjusted_output.sgst, p.adjusted_output.igst, p.adjusted_output.cess],
    ['Eligible input tax credit (4A)', p.inward_itc_4a.bill_count, p.inward_itc_4a.taxable_value, p.inward_itc_4a.cgst, p.inward_itc_4a.sgst, p.inward_itc_4a.igst, p.inward_itc_4a.cess],
    [p.net_position.is_credit_carried_forward ? 'Credit carried forward' : 'Net tax payable', '', '', p.net_position.cgst, p.net_position.sgst, p.net_position.igst, p.net_position.cess],
    ['Total net payable', '', Math.abs(p.net_position.total_net_payable)],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="GSTR-3B Summary"
        subtitle="Computed outward tax, adjustments, input tax credit and net position in 3B shape. Information only - nothing is filed from AccountX."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="info">{d?.basis ?? 'Document-truth'}</Badge>
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              {range.from} → {range.to}
            </span>
            {generatedAt && <span className="text-secondary-400 text-xs">Generated {generatedAt}</span>}
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <Tooltip label={hasRows ? 'Download the calculated figures as CSV' : 'Load the summary first'} side="bottom">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasRows}
                onClick={() => {
                  if (!d) return;
                  import('@/components/gst/gstExport').then(({ downloadCsv }) =>
                    downloadCsv(`gstr-3b_${range.from}_${range.to}.csv`, buildCsvMatrix(d))
                  );
                }}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </Tooltip>
            <Button variant="secondary" size="sm" onClick={() => setSendChannel('email')} disabled={!hasRows}>
              <Send className="h-3.5 w-3.5" /> Email
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSendChannel('whatsapp')} disabled={!hasRows}>
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
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
          title="Could not load GSTR-3B"
          message="Something went wrong querying the computed summary. Check your connection and retry."
          onRetry={() => report.refetch()}
        />
      )}

      <section id="report-print-area" className="card p-6 space-y-6" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-secondary-100 dark:border-secondary-800 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary-400">{activeBusiness?.name || 'Business'}</p>
            <h2 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100 mt-0.5">GSTR-3B</h2>
          </div>
          <div className="figure text-xs text-secondary-500 dark:text-secondary-400">
            {activeBusiness?.gst_registered && activeBusiness?.gstin ? `GSTIN ${activeBusiness.gstin} · ` : ''}
            Period {range.from} → {range.to}
          </div>
        </div>

        {/* Calculated by AccountX */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Calculated by AccountX</h3>
            <Badge variant="info">read-only · document basis · computed engine</Badge>
          </div>
          {report.isLoading && (
            <div className="animate-pulse space-y-3 py-2" aria-busy="true">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${88 - i * 8}%` }} />
              ))}
            </div>
          )}
          {d && (
            <>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['Particulars', 'Documents', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
                            i === 0 ? 'text-left' : i === 1 ? 'text-center' : 'text-right'
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <Row label="Outward supplies & liable inward (3.1(a))" docs={d.outward_3_1a.doc_count} taxable={d.outward_3_1a.taxable_value} igst={d.outward_3_1a.igst} cgst={d.outward_3_1a.cgst} sgst={d.outward_3_1a.sgst} cess={d.outward_3_1a.cess} />
                    <Row
                      label="Zero-rated exports"
                      docs={d.zero_rated.doc_count}
                      taxable={d.zero_rated.taxable_value}
                      igst={0}
                      cgst={0}
                      sgst={0}
                      cess={0}
                      mutedTax
                    />
                    <Row label={`Nil-rated / exempt outward (${d.nil_other_outward.classification})`} docs={d.nil_other_outward.doc_count} taxable={d.nil_other_outward.taxable_value} />
                    <Row
                      label={`CDNR adjustment (${d.cdnr_adjustment.credit_notes} CN / ${d.cdnr_adjustment.debit_notes} DN - signed net)`}
                      docs=""
                      taxable={d.cdnr_adjustment.taxable_net_effect}
                      igst={d.cdnr_adjustment.igst}
                      cgst={d.cdnr_adjustment.cgst}
                      sgst={d.cdnr_adjustment.sgst}
                      cess={d.cdnr_adjustment.cess}
                    />
                    <Row label="Adjusted output tax" docs="" taxable={d.adjusted_output.taxable_value} igst={d.adjusted_output.igst} cgst={d.adjusted_output.cgst} sgst={d.adjusted_output.sgst} cess={d.adjusted_output.cess} emphasis />
                    <Row label="Eligible input tax credit (4A)" docs={d.inward_itc_4a.bill_count} taxable={d.inward_itc_4a.taxable_value} igst={d.inward_itc_4a.igst} cgst={d.inward_itc_4a.cgst} sgst={d.inward_itc_4a.sgst} cess={d.inward_itc_4a.cess} />
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
                      <td className="px-3 py-2.5 font-bold text-secondary-900 dark:text-secondary-100">
                        {d.net_position.is_credit_carried_forward ? 'Credit carried forward' : 'Net tax payable'}
                        <span className="block text-xs font-normal text-secondary-500 dark:text-secondary-400 mt-0.5">
                          per component: IGST {formatCurrency(d.net_position.igst)} · CGST {formatCurrency(d.net_position.cgst)} · SGST{' '}
                          {formatCurrency(d.net_position.sgst)} · Cess {formatCurrency(d.net_position.cess)}
                        </span>
                      </td>
                      <td />
                      <TdNum emphasis>{formatCurrency(Math.abs(d.net_position.total_net_payable))}</TdNum>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="mt-3 text-xs text-secondary-400">{d.zero_rated.note}</p>

              {/* traceability strip */}
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-secondary-200 dark:border-secondary-700 p-3 text-[11px] figure text-secondary-500 dark:text-secondary-400">
                <span>Invoices {d.traceability.invoice_docs}</span>
                <span>Bills {d.traceability.bill_docs}</span>
                <span>CN {d.traceability.credit_note_docs}</span>
                <span>DN {d.traceability.debit_note_docs}</span>
                <span>Nil docs {d.traceability.nil_docs}</span>
                {typeof d.traceability.zero_rated_docs === 'number' && <span>Exports {d.traceability.zero_rated_docs}</span>}
                <span>sections fn: {d.traceability.gstr1_sections_fn}</span>
              </div>
            </>
          )}
        </div>

        {/* Adjustment worksheet — LOCAL ONLY */}
        {d && (
          <div className={cn('rounded-xl border p-4', anyAdj ? 'border-warning-300 dark:border-warning-700 bg-warning-50/50 dark:bg-warning-900/10' : 'border-secondary-200 dark:border-secondary-700')}>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Your adjustments (draft)</h3>
              <Badge variant="warning">local only - never saved or filed</Badge>
              {anyAdj && (
                <Button variant="ghost" size="sm" onClick={() => { setOutAdj(EMPTY_ADJ); setInAdj(EMPTY_ADJ); }} className="ml-auto">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
              )}
            </div>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-3 max-w-3xl">
              Pencil manual tweaks before filing on the portal. These cells are draft figures only: reloading clears them, they are never
              written to your books, and nothing here is ever presented as filed.
            </p>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">Worksheet line</th>
                    {ADJ_FIELDS.map((f) => (
                      <th key={f.key} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
                        {`${f.label} adj.`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-secondary-100 dark:border-secondary-800">
                    <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">Add to adjusted output tax</td>
                    {ADJ_FIELDS.map((f) => (
                      <td key={f.key} className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Adjustment to output ${f.label}`}
                          value={outAdj[f.key]}
                          onChange={(e) => setOutAdj({ ...outAdj, [f.key]: e.target.value })}
                          placeholder="0"
                          className="input h-8 w-28 ml-auto rounded-lg text-right figure"
                        />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-secondary-200 dark:border-secondary-700">
                    <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">Add to input tax credit (4A)</td>
                    {ADJ_FIELDS.map((f) => (
                      <td key={f.key} className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          aria-label={`Adjustment to ITC ${f.label}`}
                          value={inAdj[f.key]}
                          onChange={(e) => setInAdj({ ...inAdj, [f.key]: e.target.value })}
                          placeholder="0"
                          className="input h-8 w-28 ml-auto rounded-lg text-right figure"
                        />
                      </td>
                    ))}
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
                    <td className="px-3 py-2.5 font-bold text-secondary-900 dark:text-secondary-100">
                      Working position{anyAdj ? ' (with your adjustments)' : ''}
                      {workingNet !== null && workingNet < 0 && (
                        <span className="ml-2 text-xs font-medium text-success-600 dark:text-success-400">(credit carried forward - nothing payable)</span>
                      )}
                    </td>
                    <td colSpan={5} />
                    <TdNum emphasis>{workingNet === null ? '—' : formatCurrency(Math.abs(workingNet))}</TdNum>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </section>

      <SendDialog
        open={sendChannel !== null}
        onClose={() => setSendChannel(null)}
        contextLabel="GSTR-3B Summary"
        docType="report"
        docNumber="gstr-3b"
        templateKey="report_delivery"
        templateVariables={{ report_name: 'GSTR-3B Summary', generated_at: generatedAt, format: sendChannel === 'whatsapp' ? 'text' : 'pdf' }}
        defaultSubject={`GSTR-3B Summary · ${range.from} → ${range.to}`}
        defaultMessage={`GSTR-3B computed summary for ${range.from} → ${range.to} is attached (calculated figures; adjustments are not included). Generated at ${generatedAt}.`}
        recipients={[]}
        attachments={[
          ...(sendChannel === 'email'
            ? [
                {
                  id: 'gstr3b-pdf',
                  label: 'GSTR-3B PDF (as printed)',
                  filename: `gstr-3b_${range.from}_${range.to}.pdf`,
                  build: async () => {
                    const el = document.getElementById('report-print-area');
                    if (!el) throw new Error('The summary is not rendered yet.');
                    return captureElementToPdfBlob(el);
                  },
                },
              ]
            : []),
          {
            id: 'gstr3b-csv',
            label: 'GSTR-3B calculated figures (CSV)',
            filename: `gstr-3b_${range.from}_${range.to}.csv`,
            build: async () => {
              if (!d) throw new Error('Nothing to attach yet - load the summary first.');
              const escapeCell = (cell: string | number) => {
                const s = String(cell ?? '');
                return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
              };
              const csv = buildCsvMatrix(d).map((row) => row.map(escapeCell).join(',')).join('\n');
              return new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
            },
          },
        ]}
      />
    </div>
  );
}

function Row({
  label,
  docs,
  taxable,
  igst,
  cgst,
  sgst,
  cess,
  emphasis,
  mutedTax,
}: {
  label: string;
  docs: number | string;
  taxable?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
  cess?: number;
  emphasis?: boolean;
  mutedTax?: boolean;
}) {
  const cell = (v?: number) =>
    mutedTax && !v ? (
      <TdNum className="text-secondary-300 dark:text-secondary-600">0</TdNum>
    ) : (
      <TdNum emphasis={emphasis}>{typeof v === 'number' ? formatCurrency(v) : ''}</TdNum>
    );
  return (
    <tr className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
      <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">{label}</td>
      <td className="figure px-3 py-2 text-center whitespace-nowrap">{docs}</td>
      {cell(taxable)}
      {cell(igst)}
      {cell(cgst)}
      {cell(sgst)}
      {cell(cess)}
    </tr>
  );
}

function TdNum({ children, emphasis, className }: { children?: React.ReactNode; emphasis?: boolean; className?: string }) {
  return <td className={cn('figure text-right px-3 py-2 whitespace-nowrap', emphasis ? 'font-bold' : '', className)}>{children}</td>;
}
