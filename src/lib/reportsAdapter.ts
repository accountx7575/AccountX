import { supabase } from '@/lib/supabase';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Landmark,
  Wallet,
  ReceiptText,
  ClipboardList,
  Hourglass,
  BookOpen,
  FileText,
  ShoppingBag,
  HandCoins,
  Banknote,
  FileSpreadsheet,
  ScrollText,
  Receipt,
  Boxes,
} from 'lucide-react';

/* ============================================================================
 * Reports Adapter — the SINGLE data gateway for all report views.
 *
 * Contracts below mirror Oscar's FINAL T20/T28 reporting core
 * (migrations 020+021): RPCs get_profit_and_loss / get_balance_sheet /
 * get_receivables_aging / get_payables_aging / get_customer_statement /
 * get_supplier_statement and views v_cashflow_daily / v_day_book.
 * Field names are kept IDENTICAL to the SQL outputs — do not rename.
 *
 * Phase B: Stanley's T22/T23 bind the implementations. Until then every
 * fetch throws ReportNotReadyError — fake data structurally impossible.
 * ========================================================================== */

export type DateRange = { from: string; to: string };

/** Business ids are UUIDs (matches auth/business schema). */
export interface ReportQuery {
  businessId: string;
  range: DateRange;
}

export class ReportNotReadyError extends Error {
  readonly familyId: ReportFamilyId;
  constructor(familyId: ReportFamilyId) {
    super(`Report "${familyId}" is not bound yet — data layer lands with reports Phase B.`);
    this.name = 'ReportNotReadyError';
    this.familyId = familyId;
  }
}

/* ---------------------------------- helpers ------------------------------- */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** yyyy-mm-dd in LOCAL time (never toISOString — avoids UTC day-shift). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Indian fiscal year: 1 Apr – 31 Mar. */
export function getFiscalYear(date: Date = new Date()): { start: Date; end: Date; label: string } {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return {
    start: new Date(y, 3, 1),
    end: new Date(y + 1, 2, 31),
    label: `FY ${y}-${pad((y + 1) % 100)}`,
  };
}

export type RangePreset =
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-fy'
  | 'last-fy';

const QUARTER_START_MONTHS = [3, 6, 9, 0]; // reserved: FY-aligned quarter presets land with Phase B
void QUARTER_START_MONTHS;

export function resolvePreset(preset: RangePreset, now: Date = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'this-month':
      return { from: toISODate(new Date(y, m, 1)), to: toISODate(new Date(y, m + 1, 0)) };
    case 'last-month':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
    case 'this-quarter': {
      const qm = Math.floor(m / 3) * 3;
      return { from: toISODate(new Date(y, qm, 1)), to: toISODate(new Date(y, qm + 3, 0)) };
    }
    case 'last-quarter': {
      const qm = Math.floor(m / 3) * 3 - 3;
      return { from: toISODate(new Date(y, qm, 1)), to: toISODate(new Date(y, qm + 3, 0)) };
    }
    case 'this-fy': {
      const fy = getFiscalYear(now);
      return { from: toISODate(fy.start), to: toISODate(fy.end) };
    }
    case 'last-fy': {
      const lastStart = new Date(getFiscalYear().start.getFullYear() - 1, 3, 1);
      return { from: toISODate(lastStart), to: toISODate(new Date(lastStart.getFullYear() + 1, 2, 31)) };
    }
  }
}

/* ------------------------------ table contract ---------------------------- */
/* Rendering vocabulary for view layers; row shapes below are the DATA side. */

export type ReportColumnType = 'text' | 'currency' | 'quantity' | 'percent' | 'date';

export interface ReportColumn<K extends string = string> {
  key: K;
  label: string;
  type: ReportColumnType;
  align?: 'left' | 'right';
  emphasis?: boolean;
}

export interface ReportRow<RowKey extends string = string> {
  key: RowKey;
  label: string;
  indent?: number;
  isSection?: boolean;
  isTotal?: boolean;
  values: Record<RowKey, string | number | null>;
}

export interface ReportTable<RowKey extends string = string> {
  title: string;
  columns: ReportColumn<RowKey>[];
  rows: ReportRow<RowKey>[];
  footnotes?: string[];
}

/* --------------------- FINAL contracts (T20/T28 aligned) ------------------- */

/* --- P&L: rpc get_profit_and_loss(biz uuid, from date, to date) ----------- */

export interface ProfitLossRow {
  section: string;
  group_name: string;
  account_id: string | null;
  account_name: string | null;
  /** nature-signed positive figure */
  amount: number;
}

export interface ProfitLossReport {
  kind: 'profit-loss';
  range: DateRange;
  /** terminal row guaranteed: section='Summary', group_name='Net Profit' */
  rows: ProfitLossRow[];
}

/* --- Balance Sheet: rpc get_balance_sheet(biz uuid, as_of? date) ---------- */

export interface BalanceSheetRow {
  group_name: string;
  account_id: string | null;
  account_name: string | null;
  closing_balance: number;
  /** asset | liability | equity (per ledger nature) */
  nature: string;
}

export interface BalanceSheetReport {
  kind: 'balance-sheet';
  asOf: string;
  /**
   * Includes synthetic row account_name='Retained Earnings (P&L to date)' —
   * RENDER AS-IS, never recompute or relabel.
   */
  rows: BalanceSheetRow[];
}

/* --- Cash Flow: view v_cashflow_daily ------------------------------------- */

export interface CashflowDailyRow {
  flow_date: string;
  inflow: number;
  outflow: number;
}

export interface CashFlowReport {
  kind: 'cash-flow';
  range: DateRange;
  daily: CashflowDailyRow[];
}

/* --- Day Book: view v_day_book -------------------------------------------- */

export interface DayBookRow {
  entry_date: string;
  doc_type: string;
  doc_id: string;
  doc_number: string;
  party_name: string | null;
  description: string | null;
  debit_ledger: string;
  credit_ledger: string;
  amount: number;
}

export interface DayBookReport {
  kind: 'day-book';
  range: DateRange;
  entries: DayBookRow[];
}

/* --- Aging: rpc get_receivables_aging / get_payables_aging ---------------- */

export type AgingSide = 'receivable' | 'payable';

/**
 * One ROW PER DOCUMENT (not per party). Buckets count days PAST DUE.
 * "current" = not yet due.
 */
export interface AgingDocRow {
  party_id: string;
  party_name: string;
  doc_id: string;
  doc_number: string;
  doc_date: string;
  due_date: string;
  outstanding: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
}

export interface AgingTotals {
  outstanding: number;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_90_plus: number;
}

export interface AgingReport {
  kind: 'ar-ap-aging';
  asOf: string;
  side: AgingSide;
  rows: AgingDocRow[];
  totals: AgingTotals;
}

/** Pure client-side column sum over REAL bound rows (view-layer helper). */
export function summarizeAging(rows: AgingDocRow[]): AgingTotals {
  const t: AgingTotals = {
    outstanding: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0,
  };
  for (const r of rows) {
    t.outstanding += r.outstanding;
    t.current += r.current;
    t.days_1_30 += r.days_1_30;
    t.days_31_60 += r.days_31_60;
    t.days_61_90 += r.days_61_90;
    t.days_90_plus += r.days_90_plus;
  }
  return t;
}

/* --- Party statements: rpc get_customer_statement / get_supplier_statement - */

export type StatementSide = 'customer' | 'supplier';

export interface PartyStatementEntry {
  entry_date: string;
  doc_type: string;
  doc_number: string;
  description: string | null;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
}

export interface PartyStatementReport {
  kind: 'party-ledger';
  range: DateRange;
  side: StatementSide;
  partyId: string;
  partyName?: string;
  opening?: number;
  entries: PartyStatementEntry[];
  /**
   * SIGN CONVENTION — DO NOT FLIP:
   * customer statement positive balance = customer OWES US (receivable);
   * supplier statement positive balance = WE OWE SUPPLIER (payable).
   */
  closing: number;
}

/* --- GST Summary: rpc get_gst_summary (migration 025) ---------------------- */

export type GstSection = 'Outward' | 'Inward' | 'Summary';

export interface GstSummaryRow {
  section: GstSection;
  ledger_name: string;
  taxable_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  net_amount: number;
}

export interface GstSummaryReport {
  kind: 'gst-summary';
  range: DateRange;
  rows: GstSummaryRow[];
}

/**
 * Pure client-side reduction over REAL bound rows.
 * Terminal server row: section='Summary', ledger_name='Net GST Payable'.
 * NEGATIVE net position = refund/credit carried forward — render honestly
 * under the label returned here; never flip the sign.
 */
export function summarizeGst(rows: GstSummaryRow[]): {
  outwardTaxable: number;
  outputTax: number;
  inputTax: number;
  netPosition: number;
  netLabel: string;
} {
  let outwardTaxable = 0;
  let outputTax = 0;
  let inputTax = 0;
  let netPosition = 0;
  for (const r of rows) {
    if (r.section === 'Outward') {
      outwardTaxable += r.taxable_amount;
      outputTax += r.net_amount;
    } else if (r.section === 'Inward') {
      inputTax += r.net_amount;
    } else if (r.ledger_name === 'Net GST Payable') {
      netPosition = r.net_amount;
    }
  }
  return {
    outwardTaxable,
    outputTax,
    inputTax,
    netPosition,
    netLabel: netPosition < 0 ? 'Net GST Credit (carry-forward)' : 'Net GST Payable',
  };
}

/* ------------------------------ fetch contracts --------------------------- */
/* PURE PLUMBING over the FINAL DB contracts (migrations 020+021). Row shapes
   pass through verbatim — zero client-side recomputation of figures. RPC
   param names follow the codebase p_* convention (see get_trial_balance);
   each is a single-point-of-change if a migration differs. */

async function rpcRows<T>(fn: string, params: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw error;
  return (data ?? []) as T[];
}

async function viewRows<T>(
  view: string,
  businessId: string,
  dateCol: string,
  range?: DateRange
): Promise<T[]> {
  let q = supabase.from(view).select('*').eq('business_id', businessId);
  if (range) {
    q = q.gte(dateCol, range.from).lte(dateCol, range.to);
  }
  const { data, error } = await q.order(dateCol, { ascending: true });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function fetchProfitLoss(q: ReportQuery): Promise<ProfitLossReport> {
  const rows = await rpcRows<ProfitLossRow>('get_profit_and_loss', {
    p_business_id: q.businessId,
    p_from_date: q.range.from,
    p_to_date: q.range.to,
  });
  return { kind: 'profit-loss', range: q.range, rows };
}

export async function fetchBalanceSheet(q: { businessId: string; asOf: string }): Promise<BalanceSheetReport> {
  const rows = await rpcRows<BalanceSheetRow>('get_balance_sheet', {
    p_business_id: q.businessId,
    p_as_of: q.asOf || null,
  });
  // Includes synthetic 'Retained Earnings (P&L to date)' row — rendered as-is.
  return { kind: 'balance-sheet', asOf: q.asOf, rows };
}

export async function fetchCashFlow(q: ReportQuery): Promise<CashFlowReport> {
  const daily = await viewRows<CashflowDailyRow>('v_cashflow_daily', q.businessId, 'flow_date', q.range);
  return { kind: 'cash-flow', range: q.range, daily };
}

export async function fetchGstSummary(q: ReportQuery): Promise<GstSummaryReport> {
  const rows = await rpcRows<GstSummaryRow>('get_gst_summary', {
    p_business_id: q.businessId,
    p_from_date: q.range.from,
    p_to_date: q.range.to,
  });
  return { kind: 'gst-summary', range: q.range, rows };
}

export async function fetchDayBook(q: ReportQuery): Promise<DayBookReport> {
  const entries = await viewRows<DayBookRow>('v_day_book', q.businessId, 'entry_date', q.range);
  return { kind: 'day-book', range: q.range, entries };
}

export async function fetchAging(q: { businessId: string; asOf: string; side: AgingSide }): Promise<AgingReport> {
  const fn = q.side === 'receivable' ? 'get_receivables_aging' : 'get_payables_aging';
  const rows = await rpcRows<AgingDocRow>(fn, {
    p_business_id: q.businessId,
    p_as_of: q.asOf || null,
  });
  return { kind: 'ar-ap-aging', asOf: q.asOf, side: q.side, rows, totals: summarizeAging(rows) };
}

export async function fetchPartyLedger(
  q: ReportQuery & { side: StatementSide; partyId: string }
): Promise<PartyStatementReport> {
  const fn = q.side === 'customer' ? 'get_customer_statement' : 'get_supplier_statement';
  const entries = await rpcRows<PartyStatementEntry>(fn, {
    p_business_id: q.businessId,
    [q.side === 'customer' ? 'p_customer_id' : 'p_supplier_id']: q.partyId,
    p_from_date: q.range.from || null,
    p_to_date: q.range.to || null,
  });
  const closing = entries.length > 0 ? entries[entries.length - 1].running_balance : 0;
  return { kind: 'party-ledger', range: q.range, side: q.side, partyId: q.partyId, entries, closing };
}

/* --- Expense register: view v_expense_summary (059) ----------------------- */
/* Column names IDENTICAL to the view. Filters compose RLS-safe client-side.
   HONEST LIMIT (059 header): expenses have no party/payee column - payee
   filtering is impossible without fabrication and is deliberately absent. */

export interface ExpenseReportRow {
  expense_id: string;
  expense_number: string;
  expense_date: string;
  category_id: string | null;
  /** 'Uncategorized' COALESCE for SET-NULL orphans (view-side) */
  category_name: string;
  description: string | null;
  reference: string | null;
  payment_method: string | null;
  net_amount: number;
  tax_amount: number;
  total_amount: number;
}

export interface ExpenseReportFilters {
  categoryId?: string;
  categoryName?: string;
  paymentMethod?: string;
}

export interface ExpenseReport {
  kind: 'expense-report';
  range: DateRange;
  rows: ExpenseReportRow[];
  /** SUM(net)+SUM(tax)+SUM(total); rounding owned by this layer */
  totals: { net: number; tax: number; total: number };
  filters: ExpenseReportFilters;
}

function sumRows(rows: ExpenseReportRow[], pick: (r: ExpenseReportRow) => number): number {
  return Math.round(rows.reduce((acc, r) => acc + (Number(pick(r)) || 0), 0) * 100) / 100;
}

export async function fetchExpenseReport(
  q: ReportQuery & { filters?: ExpenseReportFilters }
): Promise<ExpenseReport> {
  let qb = supabase
    .from('v_expense_summary')
    .select('*')
    .eq('business_id', q.businessId)
    .gte('expense_date', q.range.from)
    .lte('expense_date', q.range.to);
  const f = q.filters ?? {};
  if (f.categoryId) qb = qb.eq('category_id', f.categoryId);
  if (f.categoryName) qb = qb.eq('category_name', f.categoryName);
  if (f.paymentMethod) qb = qb.eq('payment_method', f.paymentMethod);
  const { data, error } = await qb.order('expense_date', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as ExpenseReportRow[];
  return {
    kind: 'expense-report',
    range: q.range,
    rows,
    totals: {
      net: sumRows(rows, (r) => r.net_amount),
      tax: sumRows(rows, (r) => r.tax_amount),
      total: sumRows(rows, (r) => r.total_amount),
    },
    filters: f,
  };
}

/* --- Stock report: get_stock_valuation (033 FIFO/WAC) + stock_movements --- */
/* Both surfaces pass through VERBATIM. Valuation's terminal row carries
   product_id NULL and product_name '(All products)' - never recomputed here.
   Movements are date-filtered on created_at (the only time column). */

export interface StockValuationRow {
  product_id: string | null;
  product_name: string;
  quantity: number;
  total_value: number;
  avg_cost: number;
}

export interface StockMovementRow {
  id: string;
  product_id: string;
  warehouse_id: string | null;
  type: string;
  quantity: number;
  balance_after: number;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
  product?: { name: string } | null;
  warehouse?: { name: string | null } | null;
}

export interface StockReport {
  kind: 'stock-report';
  range: DateRange;
  valuation: StockValuationRow[];
  movements: StockMovementRow[];
}

export async function fetchStockReport(q: ReportQuery): Promise<StockReport> {
  const valuation = await rpcRows<StockValuationRow>('get_stock_valuation', {
    p_business_id: q.businessId,
  });
  const { data, error } = await supabase
    .from('stock_movements')
    .select(
      'id, product_id, warehouse_id, type, quantity, balance_after, unit_cost, notes, created_at, product:products(name), warehouse:warehouses(name)'
    )
    .eq('business_id', q.businessId)
    .gte('created_at', `${q.range.from}T00:00:00`)
    .lte('created_at', `${q.range.to}T23:59:59.999`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  // supabase-js types one-to-many-ish embeds as arrays; runtime shape is the object form
  return {
    kind: 'stock-report',
    range: q.range,
    valuation,
    movements: (data ?? []) as unknown as StockMovementRow[],
  };
}

/* --------------------------------- registry ------------------------------- */

export type ReportAccent = 'inflow' | 'outflow' | 'cash' | 'warn';

export type ReportStatus = 'wiring' | 'bound' | 'available';

export type ReportFamilyId =
  | 'profit-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'gst-summary'
  | 'day-book'
  | 'ar-ap-aging'
  | 'party-ledger'
  | 'sales-register'
  | 'purchase-register'
  | 'receivables'
  | 'payables'
  | 'cash-bank'
  | 'gstr-1'
  | 'gstr-3b'
  | 'expense-report'
  | 'stock-report';

export interface ReportFamilyMeta {
  id: ReportFamilyId;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: ReportAccent;
  route: string;
  status: ReportStatus;
  /** backing RPC/view per Oscar's final contracts */
  binding: string;
}

export const REPORT_REGISTRY: ReportFamilyMeta[] = [
  {
    id: 'profit-loss',
    title: 'Profit & Loss',
    description: 'Income statement over a period — revenue, expenses, net result.',
    icon: BarChart3,
    accent: 'inflow',
    route: '/app/reports/profit-loss',
    status: 'available',
    binding: 'get_profit_and_loss',
  },
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    description: 'Assets, liabilities and equity as on a date.',
    icon: Landmark,
    accent: 'cash',
    route: '/app/reports/balance-sheet',
    status: 'available',
    binding: 'get_balance_sheet',
  },
  {
    id: 'cash-flow',
    title: 'Cash Flow',
    description: 'Money in vs money out, day by day.',
    icon: Wallet,
    accent: 'outflow',
    route: '/app/reports/cash-flow',
    status: 'available',
    binding: 'v_cashflow_daily',
  },
  {
    id: 'gst-summary',
    title: 'GST Summary',
    description: 'Outward vs inward tax by component ledger, with net position.',
    icon: ReceiptText,
    accent: 'warn',
    route: '/app/reports/gst-summary',
    status: 'available',
    binding: 'get_gst_summary',
  },
  {
    id: 'day-book',
    title: 'Day Book',
    description: 'Every transaction of a period in chronological order.',
    icon: ClipboardList,
    accent: 'inflow',
    route: '/app/reports/day-book',
    status: 'available',
    binding: 'v_day_book',
  },
  {
    id: 'ar-ap-aging',
    title: 'AR / AP Aging',
    description: 'Outstanding receivables and payables bucketed by days past due.',
    icon: Hourglass,
    accent: 'warn',
    route: '/app/reports/ar-ap-aging',
    status: 'available',
    binding: 'get_receivables_aging / get_payables_aging',
  },
  {
    id: 'party-ledger',
    title: 'Party Ledger',
    description: 'Customer or supplier statement with running balance.',
    icon: BookOpen,
    accent: 'cash',
    route: '/app/reports/party-ledger',
    status: 'available',
    binding: 'get_customer_statement / get_supplier_statement',
  },
  {
    id: 'sales-register',
    title: 'Sales Register',
    description: 'Every issued sales invoice in the period, with GST split and totals.',
    icon: FileText,
    accent: 'inflow',
    route: '/app/reports/sales-register',
    status: 'available',
    binding: 'sales_invoices (issued only)',
  },
  {
    id: 'purchase-register',
    title: 'Purchase Register',
    description: 'Every confirmed purchase bill in the period, with GST split and totals.',
    icon: ShoppingBag,
    accent: 'outflow',
    route: '/app/reports/purchase-register',
    status: 'available',
    binding: 'purchase_bills (confirmed only)',
  },
  {
    id: 'receivables',
    title: 'Receivables Detail',
    description: 'Open customer invoices with amounts and ageing buckets.',
    icon: HandCoins,
    accent: 'warn',
    route: '/app/reports/receivables',
    status: 'available',
    binding: 'v_receivables_aging_base',
  },
  {
    id: 'payables',
    title: 'Payables Detail',
    description: 'Open supplier bills with amounts and ageing buckets.',
    icon: Hourglass,
    accent: 'warn',
    route: '/app/reports/payables',
    status: 'available',
    binding: 'v_payables_aging_base',
  },
  {
    id: 'cash-bank',
    title: 'Cash & Bank Movements',
    description: 'Cash vs Bank ledger inflows/outflows from posted journals.',
    icon: Banknote,
    accent: 'cash',
    route: '/app/reports/cash-bank',
    status: 'available',
    binding: "journal lines @ group 'Cash & Bank'",
  },
  {
    id: 'gstr-1',
    title: 'GSTR-1 Statement',
    description: 'Outward supplies B2B/B2C rate-wise, document basis (v_gstr1_outward). Information only — not a filing.',
    icon: FileSpreadsheet,
    accent: 'inflow',
    route: '/app/reports/gstr-1',
    status: 'available',
    binding: 'v_gstr1_outward',
  },
  {
    id: 'gstr-3b',
    title: 'GSTR-3B Summary',
    description: 'Outward tax, input tax credit and net payable in 3B shape, document basis (get_gstr_doc_summary). Information only — not a filing.',
    icon: ScrollText,
    accent: 'warn',
    route: '/app/reports/gstr-3b',
    status: 'available',
    binding: 'get_gstr_doc_summary',
  },
  {
    id: 'expense-report',
    title: 'Expense Register',
    description: 'Every expense in the period with category, method and tax split (v_expense_summary). Payee filtering is not available — expenses carry no party record.',
    icon: Receipt,
    accent: 'outflow',
    route: '/app/reports/expense-report',
    status: 'available',
    binding: 'v_expense_summary',
  },
  {
    id: 'stock-report',
    title: 'Stock Report',
    description: 'FIFO/WAC valuation snapshot plus the product- and warehouse-wise movement ledger for the period.',
    icon: Boxes,
    accent: 'cash',
    route: '/app/reports/stock-report',
    status: 'available',
    binding: 'get_stock_valuation / stock_movements',
  },
];

export function getReportMeta(id: string | undefined): ReportFamilyMeta | undefined {
  return REPORT_REGISTRY.find((r) => r.id === id);
}

/* ============================================================================
 * Sales / Purchase registers, AR/AP detail, Cash & Bank movements
 * Added in the reporting-completion block. All read live accounting data;
 * drafts and cancelled documents are excluded at query level.
 * ==========================================================================*/

export interface RegisterRow {
  doc_date: string;
  doc_number: string;
  party_name: string;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  grand_total: number;
  payment_status: string;
}

export interface RegisterReport {
  kind: 'sales-register' | 'purchase-register';
  rows: RegisterRow[];
  totals: {
    taxable: number; cgst: number; sgst: number; igst: number; grand: number; count: number;
  };
}

function r2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sumRegister(rows: RegisterRow[]): RegisterReport['totals'] {
  return rows.reduce(
    (t, r) => ({
      taxable: t.taxable + r.taxable_amount,
      cgst: t.cgst + r.cgst_amount,
      sgst: t.sgst + r.sgst_amount,
      igst: t.igst + r.igst_amount,
      grand: t.grand + r.grand_total,
      count: t.count + 1,
    }),
    { taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0, count: 0 },
  );
}

export async function fetchSalesRegister(q: ReportQuery): Promise<RegisterReport> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('invoice_number, invoice_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, grand_total, payment_status, customer:customers(name)')
    .eq('business_id', q.businessId)
    .in('status', ['issued', 'partially_paid', 'paid'])
    .gte('invoice_date', q.range.from)
    .lte('invoice_date', q.range.to)
    .order('invoice_date', { ascending: true })
    .order('invoice_number', { ascending: true });
  if (error) throw new Error(error.message);
  const rows: RegisterRow[] = (data || []).map((r: any) => ({
    doc_date: r.invoice_date,
    doc_number: r.invoice_number,
    party_name: r.customer?.name ?? '',
    taxable_amount: r2(r.taxable_amount),
    cgst_amount: r2(r.cgst_amount),
    sgst_amount: r2(r.sgst_amount),
    igst_amount: r2(r.igst_amount),
    grand_total: r2(r.grand_total),
    payment_status: r.payment_status,
  }));
  return { kind: 'sales-register', rows, totals: sumRegister(rows) };
}

export async function fetchPurchaseRegister(q: ReportQuery): Promise<RegisterReport> {
  const { data, error } = await supabase
    .from('purchase_bills')
    .select('bill_number, bill_date, taxable_amount, cgst_amount, sgst_amount, igst_amount, grand_total, payment_status, supplier:suppliers(name)')
    .eq('business_id', q.businessId)
    .eq('status', 'confirmed')
    .gte('bill_date', q.range.from)
    .lte('bill_date', q.range.to)
    .order('bill_date', { ascending: true })
    .order('bill_number', { ascending: true });
  if (error) throw new Error(error.message);
  const rows: RegisterRow[] = (data || []).map((r: any) => ({
    doc_date: r.bill_date,
    doc_number: r.bill_number,
    party_name: r.supplier?.name ?? '',
    taxable_amount: r2(r.taxable_amount),
    cgst_amount: r2(r.cgst_amount),
    sgst_amount: r2(r.sgst_amount),
    igst_amount: r2(r.igst_amount),
    grand_total: r2(r.grand_total),
    payment_status: r.payment_status,
  }));
  return { kind: 'purchase-register', rows, totals: sumRegister(rows) };
}

/* ------------------------------ GSTR statements --------------------------- */
// DOCUMENT-truth GSTR surfaces over migration 041 (v_gstr1_outward /
// v_gstr_inward / get_gstr_doc_summary). These are NOT filings and never
// claim government-portal compatibility; they exist so the numbers a filing
// would need are visible and reconcilable year-round.
//
// HONESTY BASIS (mandatory UI label): these views state what the DOCUMENTS
// say. get_gst_summary states what the JOURNALS say. The two legitimately
// diverge around CN/DN issuance and settlement timing — neither is wrong;
// both must be labelled. Raw column sums only; presentation rounding happens
// here in the report layer (r2), never inside SQL.

/** One row per (invoice, tax_rate) — canonical GSTR-1 line granularity. */
export interface Gstr1Row {
  invoice_id: string;
  doc_number: string;
  doc_date: string;
  party_name: string;
  party_gstin: string | null;
  section: 'B2B' | 'B2C';
  place_of_supply: string | null;
  tax_rate: number;
  item_count: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total_tax: number;
}

export interface GstrTaxTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface Gstr1Report {
  kind: 'gstr-1';
  basis: 'document';
  rows: Gstr1Row[];
  /** grand totals = SUM over DISPLAYED rows; doc counts are DISTINCT invoices */
  totals: GstrTaxTotals & { b2b_docs: number; b2c_docs: number };
}

export async function fetchGstr1(q: ReportQuery): Promise<Gstr1Report> {
  const { data, error } = await supabase
    .from('v_gstr1_outward')
    .select('*')
    .eq('business_id', q.businessId)
    .gte('doc_date', q.range.from)
    .lte('doc_date', q.range.to)
    .order('doc_date', { ascending: true })
    .order('doc_number', { ascending: true })
    .order('tax_rate', { ascending: true });
  if (error) throw new Error(error.message);
  const rows: Gstr1Row[] = (data || []).map((r: any) => ({
    invoice_id: r.invoice_id,
    doc_number: r.doc_number ?? '',
    doc_date: r.doc_date,
    party_name: r.party_name ?? '',
    party_gstin: r.party_gstin ?? null,
    section: r.section === 'B2B' ? 'B2B' : 'B2C',
    place_of_supply: r.place_of_supply ?? null,
    tax_rate: Number(r.tax_rate) || 0,
    item_count: Number(r.item_count) || 0,
    taxable_value: r2(r.taxable_value),
    cgst: r2(r.cgst),
    sgst: r2(r.sgst),
    igst: r2(r.igst),
    cess: r2(r.cess),
    total_tax: r2(r.total_tax),
  }));
  const docs = (section: 'B2B' | 'B2C') => new Set(rows.filter((r) => r.section === section).map((r) => r.invoice_id)).size;
  return {
    kind: 'gstr-1',
    basis: 'document',
    rows,
    totals: rows.reduce(
      (t, r) => ({
        taxable: t.taxable + r.taxable_value,
        cgst: t.cgst + r.cgst,
        sgst: t.sgst + r.sgst,
        igst: t.igst + r.igst,
        cess: t.cess + r.cess,
        b2b_docs: docs('B2B'),
        b2c_docs: docs('B2C'),
      }),
      { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, b2b_docs: docs('B2B'), b2c_docs: docs('B2C') },
    ),
  };
}

/**
 * Per-document totals = SUM across the rate-rows sharing one invoice_id.
 * Pure view-layer reduction over REAL bound rows; preserves row order.
 */
export function summarizeGstr1Docs(
  rows: Gstr1Row[]
): Array<Pick<Gstr1Row, 'invoice_id' | 'doc_number' | 'doc_date' | 'party_name' | 'party_gstin' | 'section'> & GstrTaxTotals & { total_tax: number; rates: number[] }> {
  interface DocSubtotal extends GstrTaxTotals {
    invoice_id: string;
    doc_number: string;
    doc_date: string;
    party_name: string;
    party_gstin: string | null;
    section: 'B2B' | 'B2C';
    total_tax: number;
    rates: number[];
  }
  const byDoc = new Map<string, DocSubtotal>();
  const order: string[] = [];
  for (const r of rows) {
    if (!byDoc.has(r.invoice_id)) {
      order.push(r.invoice_id);
      byDoc.set(r.invoice_id, {
        invoice_id: r.invoice_id,
        doc_number: r.doc_number,
        doc_date: r.doc_date,
        party_name: r.party_name,
        party_gstin: r.party_gstin,
        section: r.section,
        taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total_tax: 0,
        rates: [],
      });
    }
    const d = byDoc.get(r.invoice_id)!;
    d.taxable = r2(d.taxable + r.taxable_value);
    d.cgst = r2(d.cgst + r.cgst);
    d.sgst = r2(d.sgst + r.sgst);
    d.igst = r2(d.igst + r.igst);
    d.cess = r2(d.cess + r.cess);
    d.total_tax = r2(d.total_tax + r.total_tax);
    d.rates.push(r.tax_rate);
  }
  return order.map((id) => byDoc.get(id)!);
}

/** One side of get_gstr_doc_summary — verbatim RPC column names (041). */
export interface GstrDocSummarySide {
  side: 'outward' | 'inward';
  doc_count: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface Gstr3bReport {
  kind: 'gstr-3b';
  basis: 'document';
  /** table 3.1 shape */
  outward: GstrDocSummarySide;
  /** table 4A shape */
  inward: GstrDocSummarySide;
  /**
   * output_tax − input_credit, RAW sign preserved.
   * Negative = CREDIT CARRY-FORWARD, not a refund claim — render honestly.
   */
  net: number;
  credit_carryforward: boolean;
}

function taxOf(s: { cgst: number; sgst: number; igst: number; cess: number }): number {
  return r2(Number(s.cgst || 0) + Number(s.sgst || 0) + Number(s.igst || 0) + Number(s.cess || 0));
}

export async function fetchGstr3b(q: ReportQuery): Promise<Gstr3bReport> {
  const rows = await rpcRows<GstrDocSummarySide>('get_gstr_doc_summary', {
    p_business_id: q.businessId,
    p_from: q.range.from,
    p_to: q.range.to,
  });
  const blank: GstrDocSummarySide = { side: 'outward', doc_count: 0, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
  const outward = { ...blank, ...(rows.find((r) => r.side === 'outward') ?? {}) };
  const inward = { ...blank, side: 'inward' as const, ...(rows.find((r) => r.side === 'inward') ?? {}) };
  const net = r2(taxOf(outward) - taxOf(inward));
  return { kind: 'gstr-3b', basis: 'document', outward, inward, net, credit_carryforward: net < 0 };
}

/* ------------------------------ AR / AP detail ---------------------------- */

export interface OutstandingRow {
  doc_id: string;
  doc_number: string;
  party_name: string;
  doc_date: string;
  due_date: string;
  grand_total: number;
  paid_amount: number;
  outstanding: number;
  days_overdue: number;
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
}

export interface OutstandingReport {
  kind: 'receivables' | 'payables';
  rows: OutstandingRow[];
  totals: { billed: number; paid: number; outstanding: number; count: number };
}

function bucketFor(daysOverdue: number): OutstandingRow['bucket'] {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

function mapOutstanding(r: any): OutstandingRow {
  return {
    doc_id: r.doc_id,
    doc_number: r.doc_number,
    party_name: r.party_name,
    doc_date: r.doc_date,
    due_date: r.due_date,
    grand_total: r2(r.grand_total),
    paid_amount: r2(r.paid_amount),
    outstanding: r2(r.outstanding),
    days_overdue: Number(r.days_overdue) || 0,
    bucket: bucketFor(Number(r.days_overdue) || 0),
  };
}

/** Open invoices with outstanding > 0. Buckets derive from the view's
 *  days_overdue (computed against CURRENT_DATE inside Postgres). */
export async function fetchReceivablesDetail(q: ReportQuery & { customerId?: string }): Promise<OutstandingReport> {
  let query = supabase
    .from('v_receivables_aging_base')
    .select('doc_id, doc_number, party_name, doc_date, due_date, grand_total, paid_amount, outstanding, days_overdue')
    .eq('business_id', q.businessId)
    .gt('outstanding', 0)
    .order('doc_date', { ascending: true });
  if (q.customerId) query = query.eq('party_id', q.customerId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(mapOutstanding);
  return {
    kind: 'receivables',
    rows,
    totals: rows.reduce(
      (t, r) => ({ billed: t.billed + r.grand_total, paid: t.paid + r.paid_amount, outstanding: t.outstanding + r.outstanding, count: t.count + 1 }),
      { billed: 0, paid: 0, outstanding: 0, count: 0 },
    ),
  };
}

export async function fetchPayablesDetail(q: ReportQuery & { supplierId?: string }): Promise<OutstandingReport> {
  let query = supabase
    .from('v_payables_aging_base')
    .select('doc_id, doc_number, party_name, doc_date, due_date, grand_total, paid_amount, outstanding, days_overdue')
    .eq('business_id', q.businessId)
    .gt('outstanding', 0)
    .order('doc_date', { ascending: true });
  if (q.supplierId) query = query.eq('party_id', q.supplierId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(mapOutstanding);
  return {
    kind: 'payables',
    rows,
    totals: rows.reduce(
      (t, r) => ({ billed: t.billed + r.grand_total, paid: t.paid + r.paid_amount, outstanding: t.outstanding + r.outstanding, count: t.count + 1 }),
      { billed: 0, paid: 0, outstanding: 0, count: 0 },
    ),
  };
}

/* --------------------------- Cash & Bank movements ------------------------ */

export interface CashBankLedgerRow {
  ledger_name: string;
  inflow: number;
  outflow: number;
  net: number;
  opening: number;
  closing: number;
}

export interface CashBankMovementsReport {
  kind: 'cash-bank';
  rows: CashBankLedgerRow[];
  totals: { opening: number; inflow: number; outflow: number; closing: number };
}

/**
 * Cash vs Bank movement report straight from posted journal lines:
 * every line whose account sits in the 'Cash & Bank' group, split by
 * direction, with opening/closing per ledger derived from lines before
 * `range.from`. Source of truth is the books - not the payments table.
 */
export async function fetchCashBankMovements(q: ReportQuery): Promise<CashBankMovementsReport> {
  const base = () =>
    supabase
      .from('journal_entry_lines')
      .select('debit_amount, credit_amount, account_name, entry:journal_entries!inner(date, status), accounts!inner(group_name)')
      .eq('accounts.group_name', 'Cash & Bank');

  const periodSel = await base()
    .eq('journal_entries.business_id', q.businessId)
    .eq('entry.status', 'posted')
    .gte('journal_entries.date', q.range.from)
    .lte('journal_entries.date', q.range.to);
  if (periodSel.error) throw new Error(periodSel.error.message);

  const openSel = await base()
    .eq('journal_entries.business_id', q.businessId)
    .eq('entry.status', 'posted')
    .lt('journal_entries.date', q.range.from);
  if (openSel.error) throw new Error(openSel.error.message);

  type Line = { debit_amount: number | null; credit_amount: number | null; account_name: string | null };
  const agg = new Map<string, { inflow: number; outflow: number }>();
  for (const l of (periodSel.data as unknown as Line[]) || []) {
    const name = l.account_name || 'Unnamed';
    const cur = agg.get(name) || { inflow: 0, outflow: 0 };
    cur.inflow += r2(l.debit_amount);   // money INTO cash/bank is a debit
    cur.outflow += r2(l.credit_amount); // money OUT is a credit
    agg.set(name, cur);
  }

  const openings = new Map<string, number>();
  for (const l of (openSel.data as unknown as Line[]) || []) {
    const name = l.account_name || 'Unnamed';
    openings.set(name, r2((openings.get(name) || 0) + Number(l.debit_amount || 0) - Number(l.credit_amount || 0)));
  }
  // Ledgers seen only in the opening pass still deserve a row.
  for (const name of openings.keys()) {
    if (!agg.has(name)) agg.set(name, { inflow: 0, outflow: 0 });
  }

  const rows: CashBankLedgerRow[] = [...agg.entries()]
    .map(([ledger_name, v]) => {
      const opening = openings.get(ledger_name) || 0;
      const net = r2(v.inflow - v.outflow);
      return { ledger_name, opening, inflow: r2(v.inflow), outflow: r2(v.outflow), net, closing: r2(opening + net) };
    })
    .sort((a, b) => a.ledger_name.localeCompare(b.ledger_name));

  const totals = rows.reduce(
    (t, r) => ({ opening: t.opening + r.opening, inflow: t.inflow + r.inflow, outflow: t.outflow + r.outflow, closing: t.closing + r.closing }),
    { opening: 0, inflow: 0, outflow: 0, closing: 0 },
  );
  return { kind: 'cash-bank', rows, totals };
}
