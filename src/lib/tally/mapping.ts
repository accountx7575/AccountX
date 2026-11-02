import type { TallyLedgerMaster, TallyStockItemMaster, TallyVoucher } from './types';

/**
 * Mapping layer: AccountX rows -> normalized Tally vouchers.
 *
 * Ledger names here MUST match the names AccountX's own journal writers use
 * (migrations 008/009/011/013b/014/029), so exported vouchers land on the
 * same ledgers the books already use:
 *   - party ledgers: customer/supplier display name (Sundry Debtors/Creditors)
 *   - 'Sales', 'Purchases', 'Round Off'
 *   - 'Output CGST'/'Output SGST'/'Output IGST' (+ cess as 'Output Cess')
 *   - 'Input CGST'/'Input SGST'/'Input IGST'
 *   - cash/bank: payments method 'cash' -> 'Cash', anything else -> 'Bank'
 */

export const SALES_ACCOUNT = 'Sales';
export const PURCHASE_ACCOUNT = 'Purchases';
export const ROUND_OFF_ACCOUNT = 'Round Off';
export const CASH_ACCOUNT = 'Cash';
export const BANK_ACCOUNT = 'Bank';
/** Counter-leg for consolidated opening-balance journals (Tally default group). */
export const OPENING_OFFSET_ACCOUNT = 'Opening Balance Offset';
export const OPENING_OFFSET_GROUP = 'Reserves & Surplus';

/**
 * Payment rows exported as Receipt/Payment vouchers. Refund-type rows
 * ('refund' / 'refund_received') are intentionally excluded: a refunded
 * credit/debit note already carries its money leg inside the CN/DN voucher,
 * so exporting the refund payment too would double-count in Tally.
 */
export const EXPORTABLE_PAYMENT_TYPES = ['received', 'made'] as const;

export function outputGstLedger(component: 'cgst' | 'sgst' | 'igst' | 'cess'): string {
  switch (component) {
    case 'cgst': return 'Output CGST';
    case 'sgst': return 'Output SGST';
    case 'igst': return 'Output IGST';
    case 'cess': return 'Output Cess';
  }
}

export function inputGstLedger(component: 'cgst' | 'sgst' | 'igst' | 'cess'): string {
  switch (component) {
    case 'cgst': return 'Input CGST';
    case 'sgst': return 'Input SGST';
    case 'igst': return 'Input IGST';
    case 'cess': return 'Input Cess';
  }
}

export function cashBankLedger(method: string): string {
  return method === 'cash' ? CASH_ACCOUNT : BANK_ACCOUNT;
}

/** Round to 2dp, tolerating float noise from numeric columns. */
function r2(n: number | null | undefined): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface InvoiceRow {
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
  customer?: { name: string } | null;
}

/** Sales voucher: Dr party (grand total) / Cr sales + output GST + round off. */
export function mapInvoiceToVoucher(inv: InvoiceRow): TallyVoucher | null {
  if (inv.status !== 'issued') return null; // drafts/cancelled never exported
  const party = inv.customer?.name?.trim();
  if (!party) return null;

  const entries: TallyVoucher['entries'] = [
    { ledgerName: party, isDebit: true, amount: r2(inv.grand_total) },
  ];
  if (r2(inv.taxable_amount) !== 0) entries.push({ ledgerName: SALES_ACCOUNT, isDebit: false, amount: r2(inv.taxable_amount) });
  if (r2(inv.cgst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('cgst'), isDebit: false, amount: r2(inv.cgst_amount) });
  if (r2(inv.sgst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('sgst'), isDebit: false, amount: r2(inv.sgst_amount) });
  if (r2(inv.igst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('igst'), isDebit: false, amount: r2(inv.igst_amount) });
  if (r2(inv.cess_amount) !== 0) entries.push({ ledgerName: outputGstLedger('cess'), isDebit: false, amount: r2(inv.cess_amount) });
  if (r2(inv.round_off ?? 0) > 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: false, amount: r2(inv.round_off) });
  if (r2(inv.round_off ?? 0) < 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: true, amount: r2(-(inv.round_off ?? 0)) });

  return {
    date: inv.invoice_date,
    voucherType: 'Sales',
    voucherNumber: inv.invoice_number,
    partyLedgerName: party,
    narration: `Sales invoice ${inv.invoice_number}`,
    entries,
  };
}

export interface BillRow {
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
  supplier?: { name: string } | null;
}

/** Purchase voucher: Dr purchases + input GST / Cr party. */
export function mapBillToVoucher(bill: BillRow): TallyVoucher | null {
  if (bill.status !== 'confirmed') return null;
  const party = bill.supplier?.name?.trim();
  if (!party) return null;

  const entries: TallyVoucher['entries'] = [];
  if (r2(bill.taxable_amount) !== 0) entries.push({ ledgerName: PURCHASE_ACCOUNT, isDebit: true, amount: r2(bill.taxable_amount) });
  if (r2(bill.cgst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('cgst'), isDebit: true, amount: r2(bill.cgst_amount) });
  if (r2(bill.sgst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('sgst'), isDebit: true, amount: r2(bill.sgst_amount) });
  if (r2(bill.igst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('igst'), isDebit: true, amount: r2(bill.igst_amount) });
  if (r2(bill.cess_amount) !== 0) entries.push({ ledgerName: inputGstLedger('cess'), isDebit: true, amount: r2(bill.cess_amount) });
  if (r2(bill.round_off ?? 0) > 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: true, amount: r2(bill.round_off) });
  if (r2(bill.round_off ?? 0) < 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: false, amount: r2(-(bill.round_off ?? 0)) });
  entries.push({ ledgerName: party, isDebit: false, amount: r2(bill.grand_total) });

  return {
    date: bill.bill_date,
    voucherType: 'Purchase',
    voucherNumber: bill.bill_number,
    partyLedgerName: party,
    narration: `Purchase bill ${bill.bill_number}`,
    entries,
  };
}

export interface PaymentRow {
  payment_number: string;
  date: string;
  type: string; // 'received' | 'made'
  payment_method: string | null;
  amount: number | null;
  party_name?: string | null;
}

/** Receipt/Payment voucher: two-leg money movement. */
export function mapPaymentToVoucher(p: PaymentRow): TallyVoucher | null {
  const party = p.party_name?.trim();
  const amount = r2(p.amount);
  if (!party || amount === 0) return null;
  const cashBank = cashBankLedger(p.payment_method || 'cash');

  if (p.type === 'received') {
    // Dr Cash/Bank / Cr customer
    return {
      date: p.date,
      voucherType: 'Receipt',
      voucherNumber: p.payment_number,
      partyLedgerName: party,
      narration: `Payment received via ${p.payment_method || 'cash'}`,
      entries: [
        { ledgerName: cashBank, isDebit: true, amount },
        { ledgerName: party, isDebit: false, amount },
      ],
    };
  }
  // Dr supplier / Cr Cash/Bank
  return {
    date: p.date,
    voucherType: 'Payment',
    voucherNumber: p.payment_number,
    partyLedgerName: party,
    narration: `Payment made via ${p.payment_method || 'cash'}`,
    entries: [
      { ledgerName: party, isDebit: true, amount },
      { ledgerName: cashBank, isDebit: false, amount },
    ],
  };
}

/** Party ledger masters from live customer/supplier rows. */
export interface PartyRow {
  name: string;
  gstin?: string | null;
  state?: string | null;
  address?: string | null;
  pincode?: string | null;
}

export function mapPartiesToMasters(customers: PartyRow[], suppliers: PartyRow[]): TallyLedgerMaster[] {
  const masters: TallyLedgerMaster[] = [];
  for (const c of customers) {
    if (!c.name?.trim()) continue;
    masters.push({
      name: c.name.trim(),
      parent: 'Sundry Debtors',
      address: c.address || undefined,
      gstin: c.gstin || undefined,
      state: c.state || undefined,
      pincode: c.pincode || undefined,
    });
  }
  for (const s of suppliers) {
    if (!s.name?.trim()) continue;
    masters.push({
      name: s.name.trim(),
      parent: 'Sundry Creditors',
      address: s.address || undefined,
      gstin: s.gstin || undefined,
      state: s.state || undefined,
      pincode: s.pincode || undefined,
    });
  }
  return masters;
}

/** Stock item masters from active product rows (reference masters only). */
export interface ProductRow {
  name: string;
  unit: string | null;
  hsn_sac?: string | null;
  description?: string | null;
}

export function mapProductsToStockMasters(products: ProductRow[]): TallyStockItemMaster[] {
  const items: TallyStockItemMaster[] = [];
  for (const p of products) {
    if (!p.name?.trim()) continue;
    items.push({
      name: p.name.trim(),
      parent: 'Primary',
      baseUnit: (p.unit || 'Nos').trim() || 'Nos',
      hsnSac: p.hsn_sac?.trim() || undefined,
      description: p.description?.trim() || undefined,
    });
  }
  return items;
}

/**
 * Journal voucher from a posted journal_entries row + its lines.
 * Uses the REAL journal_entry_lines columns (account_name, debit_amount,
 * credit_amount - migration 001); callers selecting other column names get
 * a PostgREST error before this mapper is ever reached.
 * System journals whose reference_type is a source document are skipped by
 * the caller (they are already represented by that document's voucher).
 */
export interface JournalLineRow {
  account_name: string;
  debit_amount: number | null;
  credit_amount: number | null;
}

export interface JournalRow {
  entry_number: string;
  date: string;
  narration: string | null;
  lines: JournalLineRow[];
}

export function mapJournalToVoucher(je: JournalRow): TallyVoucher | null {
  const entries: TallyVoucher['entries'] = [];
  for (const l of je.lines || []) {
    const ledger = l.account_name?.trim();
    const debit = r2(l.debit_amount);
    const credit = r2(l.credit_amount);
    if (!ledger || (debit === 0 && credit === 0)) continue;
    entries.push({ ledgerName: ledger, isDebit: debit > 0, amount: Math.abs(debit > 0 ? debit : credit) });
  }
  if (!entries.length) return null;
  return {
    date: je.date,
    voucherType: 'Journal',
    voucherNumber: je.entry_number,
    partyLedgerName: entries[0].ledgerName,
    narration: je.narration?.trim() || `Journal ${je.entry_number}`,
    entries,
  };
}

/**
 * Credit note (sales return) voucher - mirror of the sales invoice:
 * Dr Sales + Dr Output GST (+ Round Off per sign) / Cr customer grand total.
 * Only issued/applied notes have accounting effect; draft/cancelled never export.
 */
export interface CreditNoteRow {
  credit_note_number: string;
  date: string;
  status: string;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  cess_amount: number | null;
  round_off: number | null;
  grand_total: number | null;
  reason?: string | null;
  customer?: { name: string } | null;
}

export function mapCreditNoteToVoucher(cn: CreditNoteRow): TallyVoucher | null {
  if (cn.status !== 'issued' && cn.status !== 'applied') return null;
  const party = cn.customer?.name?.trim();
  if (!party) return null;

  // grand_total = taxable + taxes + round_off, so the round-off leg flips
  // side relative to an invoice: positive adds a DEBIT here.
  const ro = r2(cn.round_off ?? 0);
  const entries: TallyVoucher['entries'] = [];
  if (r2(cn.taxable_amount) !== 0) entries.push({ ledgerName: SALES_ACCOUNT, isDebit: true, amount: r2(cn.taxable_amount) });
  if (r2(cn.cgst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('cgst'), isDebit: true, amount: r2(cn.cgst_amount) });
  if (r2(cn.sgst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('sgst'), isDebit: true, amount: r2(cn.sgst_amount) });
  if (r2(cn.igst_amount) !== 0) entries.push({ ledgerName: outputGstLedger('igst'), isDebit: true, amount: r2(cn.igst_amount) });
  if (r2(cn.cess_amount) !== 0) entries.push({ ledgerName: outputGstLedger('cess'), isDebit: true, amount: r2(cn.cess_amount) });
  if (ro > 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: true, amount: ro });
  if (ro < 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: false, amount: -ro });
  entries.push({ ledgerName: party, isDebit: false, amount: r2(cn.grand_total) });

  return {
    date: cn.date,
    voucherType: 'Credit Note',
    voucherNumber: cn.credit_note_number,
    partyLedgerName: party,
    narration: `Credit note ${cn.credit_note_number}${cn.reason ? ` - ${cn.reason}` : ''}`,
    entries,
  };
}

/**
 * Debit note (purchase return) voucher - mirror of the purchase bill:
 * Dr supplier grand total / Cr Purchases + Cr Input GST (+ Round Off).
 */
export interface DebitNoteRow {
  debit_note_number: string;
  date: string;
  status: string;
  taxable_amount: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  cess_amount: number | null;
  round_off: number | null;
  grand_total: number | null;
  reason?: string | null;
  supplier?: { name: string } | null;
}

export function mapDebitNoteToVoucher(dn: DebitNoteRow): TallyVoucher | null {
  if (dn.status !== 'issued' && dn.status !== 'applied') return null;
  const party = dn.supplier?.name?.trim();
  if (!party) return null;

  const ro = r2(dn.round_off ?? 0);
  const entries: TallyVoucher['entries'] = [
    { ledgerName: party, isDebit: true, amount: r2(dn.grand_total) },
  ];
  if (r2(dn.taxable_amount) !== 0) entries.push({ ledgerName: PURCHASE_ACCOUNT, isDebit: false, amount: r2(dn.taxable_amount) });
  if (r2(dn.cgst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('cgst'), isDebit: false, amount: r2(dn.cgst_amount) });
  if (r2(dn.sgst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('sgst'), isDebit: false, amount: r2(dn.sgst_amount) });
  if (r2(dn.igst_amount) !== 0) entries.push({ ledgerName: inputGstLedger('igst'), isDebit: false, amount: r2(dn.igst_amount) });
  if (r2(dn.cess_amount) !== 0) entries.push({ ledgerName: inputGstLedger('cess'), isDebit: false, amount: r2(dn.cess_amount) });
  if (ro > 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: false, amount: ro });
  if (ro < 0) entries.push({ ledgerName: ROUND_OFF_ACCOUNT, isDebit: true, amount: -ro });

  return {
    date: dn.date,
    voucherType: 'Debit Note',
    voucherNumber: dn.debit_note_number,
    partyLedgerName: party,
    narration: `Debit note ${dn.debit_note_number}${dn.reason ? ` - ${dn.reason}` : ''}`,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Opening balances
// ---------------------------------------------------------------------------

/** One party's outstanding as of the opening date (from aging RPC rows). */
export interface OpeningPartyBalance {
  partyName: string;
  /** positive = they owe / we owe; negative = advance on either side */
  amount: number;
}

/** Cash/Bank ledger opening as of the opening date (computed by caller). */
export interface OpeningCashBalance {
  ledgerName: string;
  /** signed; positive = debit balance (money), negative = overdrawn */
  opening: number;
}

function signedEntry(entries: TallyVoucher['entries'], ledgerName: string, amount: number): void {
  const amt = r2(amount);
  if (amt === 0) return;
  entries.push({ ledgerName, isDebit: amt > 0, amount: Math.abs(amt) });
}

function offsetEntry(entries: TallyVoucher['entries']): void {
  const net = entries.reduce((acc, e) => acc + (e.isDebit ? e.amount : -e.amount), 0);
  const netR = r2(net);
  if (netR === 0) return;
  // offset must mirror the net: net debit -> credit offset
  signedEntry(entries, OPENING_OFFSET_ACCOUNT, -netR);
}

/** Consolidated AR opening journal (Dr debtors / Cr offset). */
export function buildArOpeningVoucher(balances: OpeningPartyBalance[], asOf: string): TallyVoucher | null {
  const entries: TallyVoucher['entries'] = [];
  for (const b of balances) {
    if (!b.partyName?.trim()) continue;
    signedEntry(entries, b.partyName.trim(), b.amount);
  }
  if (!entries.length) return null;
  offsetEntry(entries);
  return {
    date: asOf,
    voucherType: 'Journal',
    voucherNumber: 'OPEN-AR',
    partyLedgerName: entries[0].ledgerName,
    narration: `Opening accounts receivable as of ${asOf} (system generated)`,
    entries,
  };
}

/** Consolidated AP opening journal (Dr offset / Cr creditors). */
export function buildApOpeningVoucher(balances: OpeningPartyBalance[], asOf: string): TallyVoucher | null {
  const mirrored = balances.map((b) => ({ ...b, amount: -b.amount }));
  const v = buildArOpeningVoucher(mirrored, asOf);
  if (!v) return null;
  v.voucherNumber = 'OPEN-AP';
  v.narration = `Opening accounts payable as of ${asOf} (system generated)`;
  return v;
}

/** Consolidated Cash/Bank opening journal. */
export function buildCashBankOpeningVoucher(balances: OpeningCashBalance[], asOf: string): TallyVoucher | null {
  const entries: TallyVoucher['entries'] = [];
  for (const b of balances) {
    if (!b.ledgerName?.trim()) continue;
    signedEntry(entries, b.ledgerName.trim(), b.opening);
  }
  if (!entries.length) return null;
  offsetEntry(entries);
  return {
    date: asOf,
    voucherType: 'Journal',
    voucherNumber: 'OPEN-CASHBANK',
    partyLedgerName: entries[0].ledgerName,
    narration: `Opening cash & bank as of ${asOf} (system generated)`,
    entries,
  };
}

/**
 * Ledger master for the consolidated opening offset account. Append to the
 * bundle's masters whenever any opening voucher is present.
 */
export function openingOffsetMaster(): TallyLedgerMaster {
  return { name: OPENING_OFFSET_ACCOUNT, parent: OPENING_OFFSET_GROUP };
}

/**
 * Cash/Bank opening derivation rule (documented honestly):
 *   opening(as-of range start) = live current_balance - net movement within
 *   [from..to] taken from posted journal lines on the Cash/Bank ledgers.
 * Complete ONLY for books kept under the AccountX journal engine; businesses
 * with pre-engine history may see drifted openings. The caller supplies the
 * window sums so this stays pure.
 */
export function deriveCashBankOpening(
  currentBalance: number,
  windowNetMovement: number,
): number {
  return r2(r2(currentBalance) - r2(windowNetMovement));
}
