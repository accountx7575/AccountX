import { supabase } from '@/lib/supabase';

/**
 * Typed client for the GST / ledger server surfaces consumed by the Tally
 * export engine (and reusable by future GSTR work).
 *
 * This is the LIBRARY-level surface: plain typed wrappers with honest errors.
 * It intentionally has no coupling to the reports registry (that page-facing
 * layer lives in lib/reportsAdapter.ts).
 *
 * Contracts (migrations):
 *  - get_gst_summary(p_business_id, p_from_date, p_to_date)   -> 025
 *  - get_receivables_aging(p_business_id, p_as_of?)           -> 021
 *  - get_payables_aging(p_business_id, p_as_of?)              -> 021
 *  - get_gstr1_sections(uuid, date, date) -> jsonb            -> 052/053
 *  - get_gstr3b_computed(uuid, date, date) -> jsonb           -> 054
 *  - get_gst_validation_issues(uuid, date, date) -> table     -> 055
 *  - get_gst_reconciliation(uuid, date, date) -> jsonb        -> 056
 */

export interface GstSummaryRow {
  section: string; // 'Outward' | 'Inward' | 'Summary'
  ledger_name: string;
  taxable_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  net_amount: number;
}

export interface AgingRow {
  party_id?: string;
  party_name?: string;
  invoice_number?: string | null;
  bill_number?: string | null;
  doc_number?: string | null;
  due_date?: string | null;
  /** outstanding as of the as-of date (021 naming) */
  outstanding?: number;
  [bucket: string]: unknown;
}

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(error.message || `${context} failed`);
  }
}

/** GST summary rows for a period. Negative net on the terminal Summary row = credit carry-forward. */
export async function fetchGstSummary(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<GstSummaryRow[]> {
  const { data, error } = await supabase.rpc('get_gst_summary', {
    p_business_id: businessId,
    p_from_date: fromDate,
    p_to_date: toDate,
  });
  throwIfError(error as { message: string } | null, 'GST summary');
  return (data ?? []) as unknown as GstSummaryRow[];
}

/**
 * Receivables aging as of a date (defaults to today server-side).
 * One row per invoice with outstanding > 0 AS OF p_as_of - the basis for
 * opening-AR figures in Tally exports.
 */
export async function fetchReceivablesAging(businessId: string, asOf?: string): Promise<AgingRow[]> {
  const params: Record<string, unknown> = { p_business_id: businessId };
  if (asOf) params.p_as_of = asOf;
  const { data, error } = await supabase.rpc('get_receivables_aging', params);
  throwIfError(error as { message: string } | null, 'Receivables aging');
  return (data ?? []) as unknown as AgingRow[];
}

/** Payables aging as of a date (defaults to today server-side). */
export async function fetchPayablesAging(businessId: string, asOf?: string): Promise<AgingRow[]> {
  const params: Record<string, unknown> = { p_business_id: businessId };
  if (asOf) params.p_as_of = asOf;
  const { data, error } = await supabase.rpc('get_payables_aging', params);
  throwIfError(error as { message: string } | null, 'Payables aging');
  return (data ?? []) as unknown as AgingRow[];
}

/** Live Cash/Bank ledger balances (accounting CoA 'Cash' and 'Bank'). */
export async function fetchCashBankAccounts(
  businessId: string,
): Promise<{ name: string; current_balance: number }[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('name, current_balance')
    .eq('business_id', businessId)
    .in('name', ['Cash', 'Bank']);
  throwIfError(error as { message: string } | null, 'Cash/Bank accounts');
  return (data ?? []) as unknown as { name: string; current_balance: number }[];
}

/**
 * Net movement per Cash/Bank ledger within [fromDate..toDate], from POSTED
 * journal lines. Used to derive opening cash/bank:
 *   opening = live balance - net in-window movement.
 */
export async function fetchCashBankWindowMovement(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<{ Cash: number; Bank: number }> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('lines:journal_entry_lines(account_name, debit_amount, credit_amount)')
    .eq('business_id', businessId)
    .eq('status', 'posted')
    .gte('date', fromDate)
    .lte('date', toDate);
  throwIfError(error as { message: string } | null, 'Cash/Bank window movement');
  const net = { Cash: 0, Bank: 0 };
  for (const je of (data ?? []) as unknown as {
    lines: { account_name: string; debit_amount: number | null; credit_amount: number | null }[];
  }[]) {
    for (const l of Array.isArray(je.lines) ? je.lines : []) {
      if (l.account_name === 'Cash') net.Cash += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
      else if (l.account_name === 'Bank') net.Bank += Number(l.debit_amount || 0) - Number(l.credit_amount || 0);
    }
  }
  net.Cash = Math.round(net.Cash * 100) / 100;
  net.Bank = Math.round(net.Bank * 100) / 100;
  return net;
}

// ---------------------------------------------------------------------------
// GSTR-1 sections (052 views + 053 assembler)
// ---------------------------------------------------------------------------

export interface Gstr1Section {
  rows: Record<string, unknown>[];
  totals: Record<string, number>;
}

export interface Gstr1Sections {
  period?: { from?: string; to?: string };
  b2b: Gstr1Section;
  b2c: Gstr1Section;
  /** doc-granularity rows w/ effect 'decreases_output'|'increases_output' (items carry blended tax, no tax_rate) */
  cdnr: Gstr1Section;
  nil: Gstr1Section;
  hsn: Gstr1Section;
  [key: string]: unknown;
}

/** Full GSTR-1 filing-table payload assembled from security_invoker views. */
export async function fetchGstr1Sections(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<Gstr1Sections> {
  const { data, error } = await supabase.rpc('get_gstr1_sections', {
    p_business_id: businessId,
    p_from: fromDate,
    p_to: toDate,
  });
  throwIfError(error as { message: string } | null, 'GSTR-1 sections');
  return (data ?? {}) as unknown as Gstr1Sections;
}

// ---------------------------------------------------------------------------
// GSTR-3B computed (054)
// ---------------------------------------------------------------------------

export interface Gstr3bNetPosition {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total_net_payable: number;
  is_credit_carried_forward: boolean;
}

export interface Gstr3bComputed {
  /** always 'document-truth' today */
  basis: string;
  outward_3_1a: Record<string, unknown>;
  /** HONEST zeros + note until is_export columns land (057) */
  zero_rated: Record<string, unknown> & { note?: string };
  nil_other_outward: Record<string, unknown>;
  cdnr_adjustment: Record<string, unknown>;
  adjusted_output: Record<string, unknown>;
  inward_itc_4a: Record<string, unknown>;
  net_position: Gstr3bNetPosition;
  [key: string]: unknown;
}

/** Document-truth GSTR-3B computation with full traceability counts. */
export async function fetchGstr3bComputed(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<Gstr3bComputed> {
  const { data, error } = await supabase.rpc('get_gstr3b_computed', {
    p_business_id: businessId,
    p_from: fromDate,
    p_to: toDate,
  });
  throwIfError(error as { message: string } | null, 'GSTR-3B computed');
  return (data ?? {}) as unknown as Gstr3bComputed;
}

// ---------------------------------------------------------------------------
// GST validation engine (055)
// ---------------------------------------------------------------------------

export type GstValidationSeverity = 'critical' | 'warning' | 'info';

export interface GstValidationIssueRow {
  severity: GstValidationSeverity;
  doc_type: string;
  doc_id: string;
  doc_number: string;
  doc_date: string;
  party: string | null;
  problem: string;
  code: string;
  suggested_fix: string | null;
}

/**
 * Server-truth document validation. Codes (055): GSTIN_FORMAT /
 * PARTY_GSTIN_MISSING / POS_MISSING / HSN_MISSING / TAX_MODE_CONFLICT /
 * STATE_UNKNOWN / TAXABLE_MISMATCH / GRAND_TOTAL_IDENTITY /
 * DOC_NUMBER_DUP_CI / EXCLUDED_FROM_REPORT.
 */
export async function fetchGstValidationIssues(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<GstValidationIssueRow[]> {
  const { data, error } = await supabase.rpc('get_gst_validation_issues', {
    p_business_id: businessId,
    p_from: fromDate,
    p_to: toDate,
  });
  throwIfError(error as { message: string } | null, 'GST validation issues');
  return (data ?? []) as unknown as GstValidationIssueRow[];
}

// ---------------------------------------------------------------------------
// GST reconciliation engine (056)
// ---------------------------------------------------------------------------

export type GstMatchStatus = 'matched' | 'difference' | 'unjournaled' | 'multi_posted';

export interface GstReconciliationRow {
  doc_type: string;
  doc_id: string;
  doc_number: string;
  doc_date: string;
  party_name?: string | null;
  match_status: GstMatchStatus;
  unmapped_residual?: number;
  [key: string]: unknown;
}

export interface GstReconciliation {
  rows: GstReconciliationRow[];
  totals: Record<string, number> & { absolute_difference_sum?: number };
  notes_coverage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Per-doc document-tax vs journal-entry-tax reconciliation. */
export async function fetchGstReconciliation(
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<GstReconciliation> {
  const { data, error } = await supabase.rpc('get_gst_reconciliation', {
    p_business_id: businessId,
    p_from: fromDate,
    p_to: toDate,
  });
  throwIfError(error as { message: string } | null, 'GST reconciliation');
  return (data ?? {}) as unknown as GstReconciliation;
}
