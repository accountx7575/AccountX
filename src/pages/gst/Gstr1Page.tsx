import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, Send, MessageCircle, Layers, ArrowDownRight, ArrowUpRight, FileQuestion } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FilterBar } from '@/components/ui/FilterBar';
import { Tooltip } from '@/components/ui/Tooltip';
import { ReportDateRangeFilter } from '@/components/reports/ReportDateRangeFilter';
import { SendDialog } from '@/components/comms/SendDialog';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import { cn, formatCurrency } from '@/lib/utils';
import { resolvePreset, type DateRange } from '@/lib/reportsAdapter';
import {
  getGstr1Sections,
  type Gstr1OutwardRow,
  type GstrCdnRow,
  type GstrNilRow,
  type GstrHsnRow,
} from '@/components/gst/gstApi';
import { downloadCsv, downloadGstr1RateCsv, summarizeGstr1Rates } from '@/components/gst/gstExport';

/* ============================================================================
 * /app/gst/gstr-1 - outward supplies statement (T103 bind phase).
 * ALL five section tabs are LIVE over get_gstr1_sections (053):
   B2B/B2C rate-lines w/ per-doc subtotals; CDNR doc-level w/ honest
   CN-down / DN-up direction chips (effect field, never magic signs);
   Nil/Exempt whole-doc zero-tax invoices; HSN summary incl the
   UNCLASSIFIED sentinel rendered as-is. Basis label comes from payload.
 * ==========================================================================*/

type TabId = 'b2b' | 'b2c' | 'cdnr' | 'nil' | 'hsn';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'b2b', label: 'B2B' },
  { id: 'b2c', label: 'B2C' },
  { id: 'cdnr', label: 'Credit-Debit Notes' },
  { id: 'nil', label: 'Nil / Exempt' },
  { id: 'hsn', label: 'HSN Summary' },
];

export function Gstr1Page() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const businessId = activeBusiness?.id;

  const [range, setRange] = useState<DateRange>(() => resolvePreset('this-fy'));
  const [tab, setTab] = useState<TabId>('b2b');
  const [search, setSearch] = useState('');
  const [sendChannel, setSendChannel] = useState<'email' | 'whatsapp' | null>(null);

  const report = useQuery({
    queryKey: ['gst-gstr1-sections', businessId, range.from, range.to],
    queryFn: () => getGstr1Sections(businessId!, range.from, range.to),
    enabled: !!businessId,
  });

  const q = search.trim().toLowerCase();
  const filteredOutward = useMemo(() => {
    const rows = tab === 'b2b' ? report.data?.b2b.rows ?? [] : tab === 'b2c' ? report.data?.b2c.rows ?? [] : [];
    if (!q) return rows;
    return rows.filter((r) => r.doc_number.toLowerCase().includes(q) || (r.party_name ?? '').toLowerCase().includes(q) || (r.party_gstin ?? '').toLowerCase().includes(q));
  }, [report.data, tab, q]);

  const filteredCdnr = useMemo(() => {
    const rows = tab === 'cdnr' ? report.data?.cdnr.rows ?? [] : [];
    if (!q) return rows;
    return rows.filter((r) => r.doc_number.toLowerCase().includes(q) || (r.party_name ?? '').toLowerCase().includes(q) || (r.reason ?? '').toLowerCase().includes(q));
  }, [report.data, tab, q]);

  const filteredNil = useMemo(() => {
    const rows = tab === 'nil' ? report.data?.nil.rows ?? [] : [];
    if (!q) return rows;
    return rows.filter((r) => r.doc_number.toLowerCase().includes(q) || (r.party_name ?? '').toLowerCase().includes(q));
  }, [report.data, tab, q]);

  const filteredHsn = useMemo(() => {
    const rows = tab === 'hsn' ? report.data?.hsn.rows ?? [] : [];
    if (!q) return rows;
    return rows.filter((r) => r.hsn_sac.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q) || r.unit.toLowerCase().includes(q));
  }, [report.data, tab, q]);

  const rateSummary = useMemo(
    () => (tab === 'b2b' || tab === 'b2c' ? summarizeGstr1Rates(filteredOutward as Gstr1OutwardRow[]) : []),
    [tab, filteredOutward]
  );

  const hasRows =
    filteredOutward.length > 0 || filteredCdnr.length > 0 || filteredNil.length > 0 || filteredHsn.length > 0;
  const generatedAt = report.dataUpdatedAt ? new Date(report.dataUpdatedAt).toLocaleString() : '';
  const activeTab = TABS.find((t) => t.id === tab)!;

  const buildCsv = (): (string | number)[][] | null => {
    switch (tab) {
      case 'b2b':
      case 'b2c':
        return [
          ['Section', 'Invoice No', 'Date', 'Party', 'GSTIN', 'Place of Supply', 'Rate %', 'Items', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
          ...filteredOutward.map((r) => [r.section, r.doc_number, r.doc_date, r.party_name ?? '', r.party_gstin ?? '', r.place_of_supply ?? '', r.tax_rate, r.item_count, r.taxable_value, r.cgst, r.sgst, r.igst, r.cess]),
        ];
      case 'cdnr':
        return [
          ['Note Type', 'Effect', 'Note No', 'Date', 'Party', 'GSTIN', 'B2B/B2C', 'Original Doc', 'Reason', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
          ...filteredCdnr.map((r) => [r.note_type, r.effect, r.doc_number, r.doc_date, r.party_name ?? '', r.party_gstin ?? '', r.section, r.parent_doc_number ?? '', r.reason ?? '', r.taxable_value, r.cgst, r.sgst, r.igst, r.cess]),
        ];
      case 'nil':
        return [
          ['Invoice No', 'Date', 'Party', 'GSTIN', 'B2B/B2C', 'Place of Supply', 'Classification', 'Items', 'Quantity', 'Taxable'],
          ...filteredNil.map((r) => [r.doc_number, r.doc_date, r.party_name ?? '', r.party_gstin ?? '', r.section, r.place_of_supply ?? '', r.classification, r.item_count, r.quantity, r.taxable_value]),
        ];
      case 'hsn':
        return [
          ['HSN/SAC', 'Unit', 'Rate %', 'Description', 'Items', 'Quantity', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
          ...filteredHsn.map((r) => [r.hsn_sac, r.unit, r.tax_rate, r.description ?? '', r.item_count, r.quantity, r.taxable_value, r.cgst, r.sgst, r.igst, r.cess]),
        ];
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="GSTR-1"
        subtitle="Outward supplies statement across all five sections. Information only - nothing is submitted to the portal from AccountX."
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variant="info">{report.data?.basis ?? 'Document-truth'}</Badge>
            <span className="rounded-full bg-secondary-100 dark:bg-secondary-800 px-2.5 py-0.5 figure text-secondary-600 dark:text-secondary-300">
              {range.from} → {range.to}
            </span>
            {generatedAt && <span className="text-secondary-400 text-xs">Generated {generatedAt}</span>}
          </span>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <Tooltip label={hasRows ? 'Download this section as CSV' : 'Load the statement first'} side="bottom">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasRows}
                onClick={() => {
                  const matrix = buildCsv();
                  if (matrix) downloadCsv(`gstr-1-${tab}_${range.from}_${range.to}.csv`, matrix);
                }}
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </Tooltip>
            {(tab === 'b2b' || tab === 'b2c') && (
              <Button variant="ghost" size="sm" onClick={() => downloadGstr1RateCsv(filteredOutward, range.from, range.to)} disabled={!hasRows}>
                <Layers className="h-3.5 w-3.5" /> Rates CSV
              </Button>
            )}
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

      <div role="tablist" aria-label="GSTR-1 sections" className="flex flex-wrap gap-2 print:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              tab === t.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                : 'border-secondary-200 dark:border-secondary-700 text-secondary-600 dark:text-secondary-300 hover:border-primary-400'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={
          tab === 'hsn' ? 'Search HSN, description or unit...' : 'Search doc no, party or GSTIN...'
        }
        className="print:hidden rounded-xl border border-secondary-200/80 dark:border-secondary-800"
      />

      <section id="report-print-area" className="card p-6 space-y-6" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-secondary-100 dark:border-secondary-800 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-secondary-400">{activeBusiness?.name || 'Business'}</p>
            <h2 className="text-section-title font-bold text-secondary-900 dark:text-secondary-100 mt-0.5">
              GSTR-1 · {activeTab.label}
            </h2>
          </div>
          <div className="figure text-xs text-secondary-500 dark:text-secondary-400">
            {activeBusiness?.gst_registered && activeBusiness?.gstin ? `GSTIN ${activeBusiness.gstin} · ` : ''}
            Period {range.from} → {range.to}
          </div>
        </div>

        {report.isError && (
          <ErrorState
            title="Could not load GSTR-1"
            message="Something went wrong querying the sections engine. Check your connection and retry."
            onRetry={() => report.refetch()}
          />
        )}

        {report.isLoading && (
          <div className="animate-pulse space-y-3 py-2" aria-busy="true">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-5 rounded bg-secondary-100 dark:bg-secondary-800" style={{ width: `${90 - i * 8}%` }} />
            ))}
          </div>
        )}

        {report.data && (tab === 'b2b' || tab === 'b2c') && (
          <OutwardSection rows={filteredOutward} rates={rateSummary} totals={report.data[tab].totals} onOpen={(id) => navigate(`/app/sales-invoices/${id}`)} />
        )}

        {report.data && tab === 'cdnr' && <CdnrSection rows={filteredCdnr} totals={report.data.cdnr.totals} />}

        {report.data && tab === 'nil' && <NilSection rows={filteredNil} totals={report.data.nil.totals} />}

        {report.data && tab === 'hsn' && <HsnSection rows={filteredHsn} totals={report.data.hsn.totals} />}

        <p className="text-xs text-secondary-400 print:hidden">
          Basis: {report.data?.basis ?? 'document-truth'} over v_gstr1_outward / v_gstr1_cdn / v_gstr1_nil / v_gstr1_hsn (issued-family
          documents as stored). Can legitimately differ from the journal-basis GST Summary around note issuance and settlement timing.
        </p>
      </section>

      <SendDialog
        open={sendChannel !== null}
        onClose={() => setSendChannel(null)}
        contextLabel={`GSTR-1 · ${activeTab.label}`}
        docType="report"
        docNumber="gstr-1"
        templateKey="report_delivery"
        templateVariables={{ report_name: `GSTR-1 ${activeTab.label}`, generated_at: generatedAt, format: sendChannel === 'whatsapp' ? 'text' : 'pdf' }}
        defaultSubject={`GSTR-1 ${activeTab.label} · ${range.from} → ${range.to}`}
        defaultMessage={`GSTR-1 ${activeTab.label} for ${range.from} → ${range.to} is attached. Generated from live business data at ${generatedAt}.`}
        recipients={[]}
        attachments={[
          ...(sendChannel === 'email'
            ? [
                {
                  id: 'gstr1-pdf',
                  label: 'GSTR-1 PDF (as printed)',
                  filename: `gstr-1-${tab}_${range.from}_${range.to}.pdf`,
                  build: async () => {
                    const el = document.getElementById('report-print-area');
                    if (!el) throw new Error('The statement is not rendered yet.');
                    return captureElementToPdfBlob(el);
                  },
                },
              ]
            : []),
          {
            id: 'gstr1-csv',
            label: 'GSTR-1 section data (CSV)',
            filename: `gstr-1-${tab}_${range.from}_${range.to}.csv`,
            build: async () => {
              const matrix = buildCsv();
              if (!matrix || !hasRows) throw new Error('Nothing to attach yet - load the section first.');
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
    </div>
  );
}

/* ------------------------------ B2B / B2C --------------------------------- */

function OutwardSection({
  rows,
  rates,
  totals,
  onOpen,
}: {
  rows: Gstr1OutwardRow[];
  rates: ReturnType<typeof summarizeGstr1Rates>;
  totals: { doc_count: number } & import('@/components/gst/gstApi').GstTaxTotals;
  onOpen: (invoiceId: string) => void;
}) {
  // Per-doc subtotals need the unfiltered-by-rate grouping of THIS section's rows.
  const docs = useMemo(() => groupDocs(rows), [rows]);
  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-2">Rate-wise summary</h3>
        {rates.length === 0 ? (
          <p className="text-xs text-secondary-400">No lines in this period.</p>
        ) : (
          <Table head={<Head cols={['Rate %', 'Lines', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess']} />}>
            {rates.map((r) => (
              <tr key={`${r.section}-${r.tax_rate}`} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
                <td className="px-3 py-1.5"><Badge variant="neutral">{r.section}</Badge></td>
                <TdNum>{r.tax_rate}</TdNum>
                <TdNum>{r.docs}</TdNum>
                <TdNum>{formatCurrency(r.taxable_value)}</TdNum>
                <TdNum>{r.cgst ? formatCurrency(r.cgst) : '—'}</TdNum>
                <TdNum>{r.sgst ? formatCurrency(r.sgst) : '—'}</TdNum>
                <TdNum>{r.igst ? formatCurrency(r.igst) : '—'}</TdNum>
                <TdNum>{r.cess ? formatCurrency(r.cess) : '—'}</TdNum>
              </tr>
            ))}
          </Table>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-2">Document detail</h3>
        {rows.length === 0 ? (
          <EmptyState
            icon={FileQuestion}
            title="No documents match"
            description={rates.length === 0 ? 'Issued invoices appear here once recorded.' : 'Try clearing the search filter.'}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <Head cols={['Invoice No', 'Date', 'Party', 'GSTIN', 'Place of Supply', 'Rate %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess']} rightFrom={5} />
              </thead>
              <tbody>
                {docs.map((d) => (
                  <Fragment key={d.invoice_id}>
                    {d.rows.map((r) => (
                      <tr
                        key={`${r.invoice_id}-${r.tax_rate}`}
                        onClick={() => onOpen(r.invoice_id)}
                        className="cursor-pointer border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40 transition-colors"
                        title="Open this invoice"
                      >
                        <td className="figure px-3 py-1.5 whitespace-nowrap font-medium text-primary-600 dark:text-primary-400">{r.doc_number}</td>
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
                    ))}
                    <tr className="border-b border-secondary-200 dark:border-secondary-700 bg-secondary-50/70 dark:bg-secondary-800/40 break-inside-avoid">
                      <td className="px-3 py-1 text-xs font-semibold text-secondary-600 dark:text-secondary-300" colSpan={5}>
                        {d.rows[0].doc_number} total · {d.rows.length > 1 ? `rates ${d.rows.map((r) => r.tax_rate).join(' / ')}%` : `${d.rows[0].tax_rate}%`}
                      </td>
                      <td />
                      <TdNum className="text-xs font-semibold">{formatCurrency(d.rows.reduce((s, r) => s + r.taxable_value, 0))}</TdNum>
                      <TdNum className="text-xs font-semibold">{formatCurrency(d.rows.reduce((s, r) => s + r.cgst, 0))}</TdNum>
                      <TdNum className="text-xs font-semibold">{formatCurrency(d.rows.reduce((s, r) => s + r.sgst, 0))}</TdNum>
                      <TdNum className="text-xs font-semibold">{formatCurrency(d.rows.reduce((s, r) => s + r.igst, 0))}</TdNum>
                      <TdNum className="text-xs font-semibold">{formatCurrency(d.rows.reduce((s, r) => s + r.cess, 0))}</TdNum>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
                  <td className="px-3 py-2.5 font-bold" colSpan={6}>
                    Total ({totals.doc_count} {totals.doc_count === 1 ? 'document' : 'documents'})
                  </td>
                  <TdNum emphasis>{formatCurrency(taxSum(rows, 'taxable_value'))}</TdNum>
                  <TdNum emphasis>{formatCurrency(taxSum(rows, 'cgst'))}</TdNum>
                  <TdNum emphasis>{formatCurrency(taxSum(rows, 'sgst'))}</TdNum>
                  <TdNum emphasis>{formatCurrency(taxSum(rows, 'igst'))}</TdNum>
                  <TdNum emphasis>{formatCurrency(taxSum(rows, 'cess'))}</TdNum>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function groupDocs(rows: Gstr1OutwardRow[]): Array<{ invoice_id: string; rows: Gstr1OutwardRow[] }> {
  const map = new Map<string, Gstr1OutwardRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    if (!map.has(r.invoice_id)) {
      order.push(r.invoice_id);
      map.set(r.invoice_id, []);
    }
    map.get(r.invoice_id)!.push(r);
  }
  return order.map((invoice_id) => ({ invoice_id, rows: map.get(invoice_id)! }));
}

function taxSum<K extends 'taxable_value' | 'cgst' | 'sgst' | 'igst' | 'cess'>(rows: Gstr1OutwardRow[], k: K): number {
  return Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
}

/* --------------------------------- CDNR ----------------------------------- */

function CdnrSection({ rows, totals }: { rows: GstrCdnRow[]; totals: { doc_count: number; credit_notes: number; debit_notes: number } & import('@/components/gst/gstApi').GstTaxTotals }) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon={Layers}
        title="No credit or debit notes"
        description="Issued or applied notes touching output tax in this period appear here with their original document reference."
      />
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          <span className="inline-flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> {totals.credit_notes} credit notes (decrease output)</span>
        </Badge>
        <Badge variant="warning">
          <span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> {totals.debit_notes} debit notes (increase output)</span>
        </Badge>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <Head cols={['Type', 'Note No', 'Date', 'Party', 'Original Doc', 'Reason', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess']} rightFrom={6} />
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.doc_id} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40 transition-colors">
                <td className="px-3 py-1.5">
                  {r.note_type === 'credit_note' ? (
                    <Badge variant="success"><ArrowDownRight className="h-3 w-3 inline" /> Credit</Badge>
                  ) : (
                    <Badge variant="warning"><ArrowUpRight className="h-3 w-3 inline" /> Debit</Badge>
                  )}
                </td>
                <td className="figure px-3 py-1.5 whitespace-nowrap font-medium text-primary-600 dark:text-primary-400">{r.doc_number}</td>
                <td className="figure px-3 py-1.5 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
                <td className="px-3 py-1.5 text-secondary-700 dark:text-secondary-300 max-w-[10rem] truncate">{r.party_name || '—'}</td>
                <td className="figure px-3 py-1.5 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.parent_doc_number ?? '—'}</td>
                <td className="px-3 py-1.5 text-xs text-secondary-500 dark:text-secondary-400 max-w-[10rem] truncate">{r.reason ?? '—'}</td>
                <TdNum>{formatCurrency(r.taxable_value)}</TdNum>
                <TdNum>{r.cgst ? formatCurrency(r.cgst) : '—'}</TdNum>
                <TdNum>{r.sgst ? formatCurrency(r.sgst) : '—'}</TdNum>
                <TdNum>{r.igst ? formatCurrency(r.igst) : '—'}</TdNum>
                <TdNum>{r.cess ? formatCurrency(r.cess) : '—'}</TdNum>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
              <td className="px-3 py-2.5 font-bold" colSpan={6}>Net effect on output tax ({totals.doc_count} documents)</td>
              <TdNum emphasis>{formatCurrency(totals.taxable_value)}</TdNum>
              <TdNum emphasis>{formatCurrency(totals.cgst)}</TdNum>
              <TdNum emphasis>{formatCurrency(totals.sgst)}</TdNum>
              <TdNum emphasis>{formatCurrency(totals.igst)}</TdNum>
              <TdNum emphasis>{formatCurrency(totals.cess)}</TdNum>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-secondary-400">
        Direction follows each note's documented effect (credit decreases output, debit increases) - signs are never flipped for presentation.
        Note items carry a single blended tax, so per-rate splitting is deliberately not fabricated here.
      </p>
    </div>
  );
}

/* ------------------------------ Nil / Exempt ------------------------------ */

function NilSection({ rows, totals }: { rows: GstrNilRow[]; totals: { doc_count: number; taxable_value: number } }) {
  if (rows.length === 0)
    return <EmptyState icon={FileQuestion} title="No nil-rated or exempt invoices" description="Whole-document zero-tax live invoices appear here (Table 8 shape)." />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <Head cols={['Invoice No', 'Date', 'Party', 'B2B/B2C', 'Place of Supply', 'Classification', 'Items', 'Qty', 'Taxable']} rightFrom={6} />
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.invoice_id} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
              <td className="figure px-3 py-1.5 whitespace-nowrap font-medium">{r.doc_number}</td>
              <td className="figure px-3 py-1.5 whitespace-nowrap text-secondary-500 dark:text-secondary-400">{r.doc_date}</td>
              <td className="px-3 py-1.5 text-secondary-700 dark:text-secondary-300 max-w-[14rem] truncate">{r.party_name || '—'}</td>
              <td className="px-3 py-1.5"><Badge variant="neutral">{r.section}</Badge></td>
              <td className="px-3 py-1.5 text-xs text-secondary-500 dark:text-secondary-400 whitespace-nowrap">{r.place_of_supply ?? '—'}</td>
              <td className="px-3 py-1.5"><Badge variant="info">{r.classification}</Badge></td>
              <TdNum>{r.item_count}</TdNum>
              <TdNum>{r.quantity}</TdNum>
              <TdNum>{formatCurrency(r.taxable_value)}</TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={8}>Total ({totals.doc_count} documents)</td>
            <TdNum emphasis>{formatCurrency(totals.taxable_value)}</TdNum>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-secondary-400">Nil-rated vs exempt cannot be distinguished from stored columns alone - both share the nil_or_exempt bucket honestly.</p>
    </div>
  );
}

/* ---------------------------------- HSN ----------------------------------- */

function HsnSection({ rows, totals }: { rows: GstrHsnRow[]; totals: import('@/components/gst/gstApi').GstTaxTotals }) {
  if (rows.length === 0)
    return <EmptyState icon={Layers} title="No HSN lines" description="Item-level HSN summaries appear once invoices carry hsn_sac (item or product master)." />;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <Head cols={['HSN/SAC', 'Unit', 'Rate %', 'Description', 'Items', 'Qty', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess']} rightFrom={4} />
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.hsn_sac}-${r.unit}-${r.tax_rate}-${i}`} className="border-b border-secondary-100 dark:border-secondary-800 break-inside-avoid">
              <td className="px-3 py-1.5 whitespace-nowrap">
                {r.hsn_sac === 'UNCLASSIFIED' ? <Badge variant="warning">UNCLASSIFIED</Badge> : <span className="figure font-medium">{r.hsn_sac}</span>}
              </td>
              <td className="px-3 py-1.5 text-secondary-600 dark:text-secondary-400">{r.unit}</td>
              <TdNum>{r.tax_rate}</TdNum>
              <td className="px-3 py-1.5 text-secondary-700 dark:text-secondary-300 max-w-[14rem] truncate">{r.description ?? '—'}</td>
              <TdNum>{r.item_count}</TdNum>
              <TdNum>{Math.round(r.quantity * 1000) / 1000}</TdNum>
              <TdNum>{formatCurrency(r.taxable_value)}</TdNum>
              <TdNum>{r.cgst ? formatCurrency(r.cgst) : '—'}</TdNum>
              <TdNum>{r.sgst ? formatCurrency(r.sgst) : '—'}</TdNum>
              <TdNum>{r.igst ? formatCurrency(r.igst) : '—'}</TdNum>
              <TdNum>{r.cess ? formatCurrency(r.cess) : '—'}</TdNum>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold" colSpan={6}>Total</td>
            <TdNum emphasis>{formatCurrency(totals.taxable_value)}</TdNum>
            <TdNum emphasis>{formatCurrency(totals.cgst)}</TdNum>
            <TdNum emphasis>{formatCurrency(totals.sgst)}</TdNum>
            <TdNum emphasis>{formatCurrency(totals.igst)}</TdNum>
            <TdNum emphasis>{formatCurrency(totals.cess)}</TdNum>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-secondary-400">UNCLASSIFIED rows are shown as-is: items whose hsn_sac is missing at item AND product level. They are a real data gap, not hidden.</p>
    </div>
  );
}

/* ------------------------------ table atoms ------------------------------- */

function Head({ cols, rightFrom }: { cols: string[]; rightFrom?: number }) {
  return (
    <tr>
      {cols.map((c, i) => (
        <th
          key={c + i}
          className={cn(
            'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700',
            rightFrom !== undefined && i >= rightFrom ? 'text-right' : 'text-left'
          )}
        >
          {c}
        </th>
      ))}
    </tr>
  );
}

function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TdNum({ children, emphasis, className }: { children?: React.ReactNode; emphasis?: boolean; className?: string }) {
  return <td className={cn('figure text-right px-3 py-1.5 whitespace-nowrap', emphasis ? 'font-bold' : '', className)}>{children}</td>;
}
