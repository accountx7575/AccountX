import type { Gstr1Row, GstrDocSummarySide, GstSummaryRow } from '@/lib/reportsAdapter';

/* ============================================================================
 * GST export helpers (T103). Pure client-side matrix builders over REAL bound
 * rows from the reports adapter. BOM+RFC-quoting CSV, same convention as the
 * report detail exporter.
 * ==========================================================================*/

export function downloadCsv(filename: string, matrix: (string | number)[][]): void {
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

/** Rate-wise rollup of GSTR-1 rows (classic 4A/5A shape). */
export interface GstRateSummary {
  section: 'B2B' | 'B2C';
  tax_rate: number;
  docs: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export function summarizeGstr1Rates(rows: Gstr1Row[]): GstRateSummary[] {
  const map = new Map<string, GstRateSummary>();
  for (const r of rows) {
    const key = `${r.section}-${r.tax_rate}`;
    let e = map.get(key);
    if (!e) {
      e = { section: r.section, tax_rate: r.tax_rate, docs: 0, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
      map.set(key, e);
    }
    e.docs += 1;
    e.taxable_value += r.taxable_value;
    e.cgst += r.cgst;
    e.sgst += r.sgst;
    e.igst += r.igst;
    e.cess += r.cess;
  }
  return [...map.values()].sort((a, b) =>
    a.section === b.section ? b.tax_rate - a.tax_rate : a.section.localeCompare(b.section)
  );
}

export function downloadGstr1Csv(rows: Gstr1Row[], from: string, to: string): void {
  downloadCsv(`gstr-1_${from}_${to}.csv`, [
    ['Section', 'Invoice No', 'Date', 'Party', 'GSTIN', 'Place of Supply', 'Rate %', 'Items', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
    ...rows.map((r) => [
      r.section, r.doc_number, r.doc_date, r.party_name, r.party_gstin ?? '', r.place_of_supply ?? '',
      r.tax_rate, r.item_count, r.taxable_value, r.cgst, r.sgst, r.igst, r.cess,
    ]),
  ]);
}

export function downloadGstr1RateCsv(rows: Gstr1Row[], from: string, to: string): void {
  downloadCsv(`gstr-1-rate-summary_${from}_${to}.csv`, [
    ['Section', 'Rate %', 'Documents', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
    ...summarizeGstr1Rates(rows).map((r) => [r.section, r.tax_rate, r.docs, r.taxable_value, r.cgst, r.sgst, r.igst, r.cess]),
  ]);
}

type DocSide = Pick<GstrDocSummarySide, 'doc_count' | 'taxable_value' | 'cgst' | 'sgst' | 'igst' | 'cess'>;

export function downloadGstr3bCsv(
  outward: DocSide,
  inward: DocSide,
  net: number,
  creditCarryforward: boolean,
  from: string,
  to: string
): void {
  downloadCsv(`gstr-3b_${from}_${to}.csv`, [
    ['Particulars', 'Documents', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess'],
    ['Outward supplies & liable inward (3.1)', outward.doc_count ?? 0, outward.taxable_value, outward.cgst, outward.sgst, outward.igst, outward.cess],
    ['Eligible input tax credit (4A)', inward.doc_count ?? 0, inward.taxable_value, inward.cgst, inward.sgst, inward.igst, inward.cess],
    [creditCarryforward ? 'Credit carry-forward (nothing payable)' : 'Net tax payable', '', '', '', '', '', Math.abs(net)],
  ]);
}

export function downloadGstSummaryMatrixCsv(rows: GstSummaryRow[], from: string, to: string): void {
  downloadCsv(`gst-summary_${from}_${to}.csv`, [
    ['Basis: journal-truth (what the books posted)', '', '', '', '', '', '', ''],
    ['Section', 'Ledger', 'Taxable', 'CGST', 'SGST', 'IGST', 'Cess', 'Net'],
    ...rows.map((r) => [r.section, r.ledger_name, r.taxable_amount, r.cgst, r.sgst, r.igst, r.cess, r.net_amount]),
  ]);
}
