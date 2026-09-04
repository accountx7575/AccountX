/**
 * Tally XML export types.
 *
 * Sign convention (Tally import standard):
 *  - A DEBITED ledger:  ISDEEMEDPOSITIVE = "Yes", AMOUNT = negative
 *  - A CREDITED ledger: ISDEEMEDPOSITIVE = "No",  AMOUNT = positive
 * Every voucher's signed amounts must sum to ~0.
 */

export type TallyVoucherType =
  | 'Sales'
  | 'Purchase'
  | 'Receipt'
  | 'Payment'
  | 'Journal'
  | 'Credit Note'
  | 'Debit Note';

export interface TallyLedgerEntry {
  ledgerName: string;
  /** true = debited, false = credited */
  isDebit: boolean;
  amount: number;
}

export interface TallyLedgerMaster {
  name: string;
  parent: string; // Tally group, e.g. 'Sundry Debtors'
  address?: string;
  gstin?: string;
  state?: string;
  pincode?: string;
}

/**
 * Stock item master (products). Best-effort: Tally's XML schema for GST
 * classification of stock items varies between releases, so we emit the
 * conservative core (name / group / base unit / HSN) and DO NOT claim that
 * every Tally version picks up the HSN from this block. Voucher accounting
 * never depends on stock items - they are masters for reference only.
 */
export interface TallyStockItemMaster {
  name: string;
  parent: string; // stock group, always 'Primary' today
  baseUnit: string;
  hsnSac?: string;
  description?: string;
}

/** Business identity carried in the export file header (see generator). */
export interface TallyCompanyInfo {
  name: string;
  legalName?: string | null;
  address?: string | null;
  gstin?: string | null;
  state?: string | null;
}

export interface TallyVoucher {
  date: string; // ISO yyyy-mm-dd input; generator converts to yyyymmdd
  voucherType: TallyVoucherType;
  voucherNumber: string;
  partyLedgerName: string;
  narration: string;
  entries: TallyLedgerEntry[];
}

export interface TallyExportBundle {
  companyName: string;
  ledgers: TallyLedgerMaster[];
  vouchers: TallyVoucher[];
  stockItems?: TallyStockItemMaster[];
  company?: TallyCompanyInfo;
}

export interface TallyValidationIssue {
  severity: 'error' | 'warning';
  voucherNumber?: string;
  message: string;
}

/** One flat row of the CSV export variant. */
export interface TallyCsvRow {
  date: string; // ISO yyyy-mm-dd
  voucherType: string;
  voucherNumber: string;
  partyLedger: string;
  ledger: string;
  debit: number;
  credit: number;
  narration: string;
}
