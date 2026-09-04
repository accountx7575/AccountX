import { roundTo2 } from '@/lib/utils';

/* ============================================================================
 * Request-shaping layer for client-side document writes.
 * Pure functions ONLY — every network call stays in the pages/mutations.
 * Each builder exists so the exact wire shape is unit-testable (T40 phase-2)
 * and so regressions like the T8 balance-wipe can never silently return.
 * ========================================================================== */

/* ------------------------- customer / supplier ---------------------------- */

export type PartyForm = {
  name: string;
  company_name: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  opening_balance: string;
  credit_limit?: string;
  notes: string;
};

const partyCore = (form: PartyForm) => ({
  name: form.name,
  company_name: form.company_name || null,
  phone: form.phone || null,
  email: form.email || null,
  gstin: form.gstin || null,
  pan: form.pan || null,
  address: form.address || null,
  city: form.city || null,
  state: form.state,
  pincode: form.pincode || null,
  notes: form.notes || null,
});

/**
 * UPDATE payload: NEVER carries balance fields (opening_balance /
 * current_balance). Editing a party must not be able to move money owed —
 * that is the T8 balance-wipe fix, pinned here as code, not convention.
 */
export function buildCustomerUpdate(form: PartyForm) {
  return { ...partyCore(form), credit_limit: parseFloat(form.credit_limit ?? '0') || 0 };
}

export function buildSupplierUpdate(form: PartyForm) {
  return partyCore(form);
}

/** INSERT payload: balances allowed exactly once, at creation. */
export function buildCustomerInsert(businessId: string, form: PartyForm) {
  const opening = roundTo2(parseFloat(form.opening_balance) || 0);
  return {
    business_id: businessId,
    ...buildCustomerUpdate(form),
    opening_balance: opening,
    current_balance: opening,
  };
}

export function buildSupplierInsert(businessId: string, form: PartyForm) {
  const opening = roundTo2(parseFloat(form.opening_balance) || 0);
  return {
    business_id: businessId,
    ...buildSupplierUpdate(form),
    opening_balance: opening,
    current_balance: opening,
  };
}

/* ----------------------------- journal lines ------------------------------ */

export type RawJournalLine = { account_id: string; debit: string; credit: string };

export type JournalLinePayload = {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
};

export function buildJournalLines(raw: RawJournalLine[]): JournalLinePayload[] {
  return raw.map((l) => ({
    account_id: l.account_id,
    debit_amount: roundTo2(parseFloat(l.debit) || 0),
    credit_amount: roundTo2(parseFloat(l.credit) || 0),
  }));
}

/* ------------------------------- allocations ------------------------------ */

export type AllocationRequest = {
  referenceType: 'sales_invoice' | 'purchase_bill';
  referenceId: string;
  amount: number;
};

/**
 * Single-document full-amount allocation (T16 semantics): the whole payment
 * goes to one document. Throws BEFORE any network call when the payment
 * exceeds the document's outstanding balance — the server enforces this too,
 * but failing fast keeps the payments row from being written then orphaned.
 */
export function buildAllocationRequest(
  referenceType: AllocationRequest['referenceType'],
  referenceId: string,
  paymentAmount: number,
  docBalance: number
): AllocationRequest {
  const amount = roundTo2(paymentAmount);
  if (!(amount > 0)) throw new Error('Allocation amount must be positive');
  const balance = roundTo2(docBalance);
  if (amount > balance + 0.001) {
    throw new Error(
      `Allocation amount (${amount}) exceeds the document's outstanding balance (${balance})`
    );
  }
  return { referenceType, referenceId, amount };
}

/* ------------------------- document line math ----------------------------- */

export type DocLineInput = {
  quantity: number;
  rate: number;
  discount_amount: number;
  tax_rate: number;
  isInterState: boolean;
};

export type DocLineTotals = {
  gross_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
};

/**
 * Single implementation of invoice/bill per-line math (T113).
 * Invariants pinned here so pages cannot drift apart again:
 *  - taxable never goes negative when discount exceeds the line gross
 *    (header totals must equal the sum of line items even on over-discount)
 *  - intra-state split follows the house residual rule (m011): SGST carries
 *    the odd paisa, CGST+SGST always re-sums to the exact line tax
 */
export function computeDocLine(input: DocLineInput): DocLineTotals {
  const gross_amount = roundTo2(input.quantity * input.rate);
  const discount = roundTo2(input.discount_amount);
  const taxable_amount = roundTo2(Math.max(0, gross_amount - discount));
  const totalTax = roundTo2((taxable_amount * input.tax_rate) / 100);
  let cgst_amount = 0;
  let sgst_amount = 0;
  let igst_amount = 0;
  if (input.isInterState) {
    igst_amount = totalTax;
  } else {
    cgst_amount = roundTo2(totalTax / 2);
    sgst_amount = roundTo2(totalTax - cgst_amount);
  }
  return {
    gross_amount,
    taxable_amount,
    cgst_amount,
    sgst_amount,
    igst_amount,
    total_amount: roundTo2(taxable_amount + totalTax),
  };
}

/* --------------------------- numbering contract --------------------------- */

export const DOCUMENT_PREFIXES = {
  sales_invoice: 'INV',
  purchase_bill: 'BILL',
  payment_received: 'RCV',
  payment_made: 'PAY',
  credit_note: 'CN',
  debit_note: 'DN',
  expense: 'EXP',
  quotation: 'QT',
  sales_order: 'SO',
  purchase_order: 'PO',
} as const;

export type DocumentType = keyof typeof DOCUMENT_PREFIXES;

export function buildNumberingParams(businessId: string, docType: DocumentType, date: string) {
  return { p_business_id: businessId, p_doc_type: docType, p_date: date };
}

/** Pins the next_document_number result shape: PREFIX/YYYY/NNNNNN. */
export function documentNumberMatches(value: unknown, prefix: string): boolean {
  return typeof value === 'string'
    && new RegExp(`^${prefix}/\\d{4}/\\d{6}$`).test(value);
}
