import type { TallyValidationIssue } from './types';
import { EXPORTABLE_PAYMENT_TYPES } from './mapping';

/**
 * Pre-export preflight: doc-level data-quality checks that run BEFORE the
 * bundle is built, so users see exactly which documents will be dropped or
 * flagged and why - instead of a single opaque "N validation errors" toast.
 *
 * Pure function over raw DB-shaped rows. Status filters here mirror the
 * mapping layer exactly (issued invoices / confirmed bills / issued|applied
 * notes / refund-type payments excluded), so nothing reported here is a
 * row that would have been skipped anyway.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export interface PreflightInvoiceLike {
  invoice_number: string;
  invoice_date: string;
  status: string;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  cess_amount: number | null;
  round_off: number | null;
  grand_total: number | null;
  customer?: { name?: string | null; gstin?: string | null } | null;
}

export interface PreflightBillLike {
  bill_number: string;
  bill_date: string;
  status: string;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  cess_amount: number | null;
  round_off: number | null;
  grand_total: number | null;
  supplier?: { name?: string | null; gstin?: string | null } | null;
}

export interface PreflightPaymentLike {
  payment_number: string;
  date: string;
  type: string;
  amount: number | null;
  party_name?: string | null;
}

export interface PreflightNoteLike {
  note_number: string;
  note_date: string;
  status: string;
  kind: 'credit' | 'debit';
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  cess_amount: number | null;
  round_off: number | null;
  grand_total: number | null;
  party_name?: string | null;
}

export interface PreflightStockItemLike {
  name: string;
  baseUnit: string;
  hsnSac?: string;
}

export interface TallyPreflightInput {
  invoices?: PreflightInvoiceLike[];
  bills?: PreflightBillLike[];
  payments?: PreflightPaymentLike[];
  notes?: PreflightNoteLike[];
  stockItems?: PreflightStockItemLike[];
  /** business GST registration - gates gstin warnings */
  gstRegistered?: boolean;
}

function r2(n: number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function label(kind: string, number_: string): string {
  return `${kind} ${number_}`;
}

/** Header-math integrity: components must add up to the stored grand total. */
function totalMismatch(
  taxable: number | null,
  cgst: number | null,
  sgst: number | null,
  igst: number | null,
  cess: number | null,
  roundOff: number | null,
  grandTotal: number | null,
): boolean {
  const sum = r2(taxable) + r2(cgst) + r2(sgst) + r2(igst) + r2(cess) + r2(roundOff);
  return Math.abs(sum - r2(grandTotal)) > 0.01;
}

function checkTaxComponents(
  add: (severity: 'error' | 'warning', message: string) => void,
  row: { taxable_amount: number | null; cgst_amount: number | null; sgst_amount: number | null; igst_amount: number | null; cess_amount: number | null },
): void {
  const comps = [row.cgst_amount, row.sgst_amount, row.igst_amount, row.cess_amount];
  if (r2(row.taxable_amount) < 0) {
    add('error', 'negative taxable amount');
  }
  if (comps.some((c) => r2(c) < 0)) {
    add('error', 'negative tax component amount');
  }
  if (r2(row.taxable_amount) <= 0 && comps.some((c) => r2(c) > 0)) {
    add('error', 'GST charged on zero/negative taxable value');
  }
}

function checkGstinWarning(
  add: (severity: 'error' | 'warning', message: string) => void,
  gstin: string | null | undefined,
  hasTax: boolean,
  gstRegistered: boolean,
): void {
  if (!gstRegistered || !hasTax) return;
  if (!gstin || !gstin.trim()) {
    add('warning', 'party has no GSTIN - verify B2B vs B2NR treatment after import');
  }
}

function checkDate(
  add: (severity: 'error' | 'warning', message: string) => void,
  date: string,
): void {
  if (!ISO_DATE.test(date || '')) {
    add('error', `unparsable date "${date}"`);
  }
}

function duplicates(
  add: (severity: 'error' | 'warning', message: string) => void,
  numbers: string[],
  setLabel: string,
): void {
  const seen = new Map<string, number>();
  for (const n of numbers) seen.set(n, (seen.get(n) || 0) + 1);
  let warned = false;
  for (const [n, count] of seen) {
    if (count > 1 && !warned) {
      add('warning', `${setLabel}: duplicate document number "${n}" (${count} rows)`);
      warned = true;
    }
  }
}

export function runPreflight(input: TallyPreflightInput): TallyValidationIssue[] {
  const issues: TallyValidationIssue[] = [];
  const push =
    (voucherNumber: string) =>
    (severity: 'error' | 'warning', message: string) => {
      issues.push({ severity, voucherNumber, message });
    };

  const invoices = input.invoices?.filter((i) => i.status === 'issued') ?? [];
  const bills = input.bills?.filter((b) => b.status === 'confirmed') ?? [];
  const notes = input.notes?.filter((n) => n.status === 'issued' || n.status === 'applied') ?? [];
  const payments = (input.payments ?? []).filter(
    (p): p is PreflightPaymentLike & { type: string } =>
      (EXPORTABLE_PAYMENT_TYPES as readonly string[]).includes(p.type),
  );

  for (const inv of invoices) {
    const add = push(label('Sales', inv.invoice_number));
    if (!inv.customer?.name?.trim()) add('error', 'missing customer ledger name');
    checkDate(add, inv.invoice_date);
    checkTaxComponents(add, inv);
    if (totalMismatch(inv.taxable_amount, inv.cgst_amount, inv.sgst_amount, inv.igst_amount, inv.cess_amount, inv.round_off, inv.grand_total)) {
      add('error', 'components do not add up to grand total');
    }
    checkGstinWarning(add, inv.customer?.gstin, true, input.gstRegistered === true);
  }
  duplicates(
    (sev, msg) => issues.push({ severity: sev, voucherNumber: 'Sales (set)', message: msg }),
    invoices.map((i) => i.invoice_number),
    'Sales',
  );
  duplicates(
    (sev, msg) => issues.push({ severity: sev, voucherNumber: 'Purchase (set)', message: msg }),
    bills.map((b) => b.bill_number),
    'Purchase',
  );

  for (const bill of bills) {
    const add = push(label('Purchase', bill.bill_number));
    if (!bill.supplier?.name?.trim()) add('error', 'missing supplier ledger name');
    checkDate(add, bill.bill_date);
    checkTaxComponents(add, bill);
    if (totalMismatch(bill.taxable_amount, bill.cgst_amount, bill.sgst_amount, bill.igst_amount, bill.cess_amount, bill.round_off, bill.grand_total)) {
      add('error', 'components do not add up to grand total');
    }
    checkGstinWarning(add, bill.supplier?.gstin, true, input.gstRegistered === true);
  }

  for (const p of payments) {
    const add = push(label(p.type === 'received' ? 'Receipt' : 'Payment', p.payment_number));
    if (!p.party_name?.trim()) add('error', 'party could not be resolved to a ledger');
    if (r2(p.amount) <= 0) add('error', 'non-positive amount');
    checkDate(add, p.date);
  }

  for (const n of notes) {
    const kindLabel = n.kind === 'credit' ? 'Credit Note' : 'Debit Note';
    const add = push(label(kindLabel, n.note_number));
    if (!n.party_name?.trim()) add('error', 'missing party ledger name');
    checkDate(add, n.note_date);
    checkTaxComponents(add, n);
    if (totalMismatch(n.taxable_amount, n.cgst_amount, n.sgst_amount, n.igst_amount, n.cess_amount, n.round_off, n.grand_total)) {
      add('error', 'components do not add up to grand total');
    }
  }

  for (const item of input.stockItems ?? []) {
    const add = push(label('Stock Item', item.name));
    if (!item.baseUnit?.trim()) add('warning', 'no unit set - defaults to "Nos"');
    if (!item.hsnSac?.trim()) add('warning', 'no HSN/SAC code - Tally GST classification may need manual completion');
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return (a.voucherNumber || '').localeCompare(b.voucherNumber || '');
  });
}
