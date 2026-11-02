import { ReceiptText } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency } from '@/lib/utils';
import { summarizeGst, type GstSummaryRow } from '@/lib/reportsAdapter';

/* ============================================================================
 * GST summary matrix (T103): Output / Input / Net x CGST / SGST / IGST / Cess
 * over REAL get_gst_summary rows (journal-truth basis). Section figures are
 * plain column sums of the returned rows; the Net row uses the server's
 * terminal 'Net GST Payable' row via summarizeGst (sign never flipped) and is
 * labelled '(derived)' only when that terminal row is absent.
 * ==========================================================================*/

const TAX_HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;
type TaxHead = (typeof TAX_HEADS)[number];

function sectionSum(rows: GstSummaryRow[], section: 'Outward' | 'Inward') {
  const acc = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
  for (const r of rows) {
    if (r.section !== section) continue;
    acc.taxable += r.taxable_amount;
    acc.cgst += r.cgst;
    acc.sgst += r.sgst;
    acc.igst += r.igst;
    acc.cess += r.cess;
  }
  return acc;
}

export function GstTaxMatrix({ rows }: { rows: GstSummaryRow[] }) {
  const meaningful = rows.filter((r) => r.section !== 'Summary');
  if (meaningful.length === 0)
    return (
      <EmptyState
        icon={ReceiptText}
        title="No GST activity"
        description="No outward or inward tax documents were posted in this period."
      />
    );

  const outward = sectionSum(rows, 'Outward');
  const inward = sectionSum(rows, 'Inward');
  const summary = summarizeGst(rows);
  const hasServerNet = rows.some((r) => r.section === 'Summary' && r.ledger_name === 'Net GST Payable');
  const derivedNet: Record<TaxHead, number> = {
    cgst: outward.cgst - inward.cgst,
    sgst: outward.sgst - inward.sgst,
    igst: outward.igst - inward.igst,
    cess: outward.cess - inward.cess,
  };

  const numCell = (v: number, emphasis?: boolean, muted?: boolean) => (
    <td className={`figure text-right px-3 py-2 whitespace-nowrap ${emphasis ? 'font-bold' : ''} ${muted ? 'text-secondary-400' : ''}`}>
      {v ? formatCurrency(v) : <span className="text-secondary-300 dark:text-secondary-600">—</span>}
    </td>
  );

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              Particulars
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              Taxable
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              CGST
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              SGST
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              IGST
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-secondary-500 dark:text-secondary-400 border-b border-secondary-200 dark:border-secondary-700">
              Cess
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-secondary-100 dark:border-secondary-800">
            <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">
              Output tax (outward supplies)
            </td>
            {numCell(outward.taxable)}
            {numCell(outward.cgst)}
            {numCell(outward.sgst)}
            {numCell(outward.igst)}
            {numCell(outward.cess)}
          </tr>
          <tr className="border-b border-secondary-100 dark:border-secondary-800">
            <td className="px-3 py-2 font-medium text-secondary-900 dark:text-secondary-100">
              Input tax credit (inward supplies)
            </td>
            {numCell(inward.taxable)}
            {numCell(inward.cgst)}
            {numCell(inward.sgst)}
            {numCell(inward.igst)}
            {numCell(inward.cess)}
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-primary-500/60 bg-secondary-50/70 dark:bg-secondary-800/50">
            <td className="px-3 py-2.5 font-bold text-secondary-900 dark:text-secondary-100">
              {summary.netLabel}
              {!hasServerNet && <span className="ml-1.5 text-xs font-normal text-secondary-400">(derived)</span>}
              {summary.netPosition < 0 && (
                <span className="ml-2 text-xs font-medium text-success-600 dark:text-success-400">
                  (credit carried forward — nothing payable)
                </span>
              )}
            </td>
            {numCell(summary.outwardTaxable, true)}
            {numCell(derivedNet.cgst, true)}
            {numCell(derivedNet.sgst, true)}
            {numCell(derivedNet.igst, true)}
            {numCell(derivedNet.cess, true)}
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-secondary-400 print:hidden">
        Basis: journal-truth (get_gst_summary — what the books posted). Document-basis statements live on the GSTR-1 and GSTR-3B pages.
      </p>
    </div>
  );
}
