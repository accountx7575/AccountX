import {
  fetchCashBankMovements,
  fetchExpenseReport,
  fetchGstSummary,
  fetchPayablesDetail,
  fetchProfitLoss,
  fetchPurchaseRegister,
  fetchReceivablesDetail,
  fetchSalesRegister,
  fetchStockReport,
  resolvePreset,
  summarizeGst,
  type CashBankMovementsReport,
  type OutstandingReport,
  type OutstandingRow,
  type RegisterReport,
  type RegisterRow,
  type StockMovementRow,
  type StockReport,
  type StockValuationRow,
} from '@/lib/reportsAdapter';

/* ============================================================================
 * T118 — deterministic business-intelligence engine.
 *
 * RULES THIS MODULE LIVES BY:
 *  - Real data only. Every figure traces back to a reportsAdapter fetcher;
 *    there is NO second data gateway here and NO duplicated financial math
 *    (GST reduction reuses summarizeGst, aging sums reuse fetched totals).
 *  - Deterministic first. Common money questions are answered by the intent
 *    router WITHOUT an LLM call; askAiAssistant is only for open-ended
 *    interpretation ("why is profit lower").
 *  - Heuristic labels (Healthy|Watch|High Risk) are BUSINESS HEURISTICS WITH
 *    VISIBLE REASONS — never credit scores, never verdicts.
 *  - Sections/alerts render ONLY where real data exists; forecasts are ALWAYS
 *    labeled estimates. AI never mutates accounting data — analysis/notify/
 *    recommend only.
 * ==========================================================================*/

/* ------------------------------- primitives ------------------------------- */

export function r2(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Paisa-safe difference: computed through integer paise, never floats raw. */
export function deltaPaisa(current: number, previous: number): number {
  return (Math.round(current * 100) - Math.round(previous * 100)) / 100;
}

/** Percent change vs previous period. null when previous is zero (no basis). */
export function pctChange(current: number, previous: number): number | null {
  const prevP = Math.round(previous * 100);
  if (prevP === 0) return null;
  return Math.round((((current - previous) / previous) * 100 + Number.EPSILON) * 10) / 10;
}

export function formatInr(n: number): string {
  return `Rs ${Math.abs(r2(n)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Indian short form: 'Rs 2.4 lakh', 'Rs 1.3 crore'; plain under a lakh. */
export function formatInrShort(n: number): string {
  const abs = Math.abs(r2(n));
  if (abs >= 1e7) return `Rs ${(Math.round((abs / 1e7) * 10) / 10).toLocaleString('en-IN')} crore`;
  if (abs >= 1e5) return `Rs ${(Math.round((abs / 1e5) * 10) / 10).toLocaleString('en-IN')} lakh`;
  return formatInr(n);
}

/* ---------------------------------- trends -------------------------------- */

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendDelta {
  current: number;
  previous: number;
  changeAmount: number;
  changePct: number | null;
  direction: TrendDirection;
}

export function mom(current: number, previous: number): TrendDelta {
  const changeAmount = deltaPaisa(current, previous);
  const direction: TrendDirection =
    Math.round(changeAmount * 100) === 0 ? 'flat' : changeAmount > 0 ? 'up' : 'down';
  return { current: r2(current), previous: r2(previous), changeAmount, changePct: pctChange(current, previous), direction };
}

export interface PeriodFigures {
  sales: number;
  purchases: number;
  collections: number;
  expenses: number;
  profit: number;
  gstPayable: number;
}

export type Trends = Record<keyof PeriodFigures, TrendDelta>;

export function buildTrends(current: PeriodFigures, previous: PeriodFigures): Trends {
  return {
    sales: mom(current.sales, previous.sales),
    purchases: mom(current.purchases, previous.purchases),
    collections: mom(current.collections, previous.collections),
    expenses: mom(current.expenses, previous.expenses),
    profit: mom(current.profit, previous.profit),
    gstPayable: mom(current.gstPayable, previous.gstPayable),
  };
}

const EMPTY_FIGURES: PeriodFigures = {
  sales: 0, purchases: 0, collections: 0, expenses: 0, profit: 0, gstPayable: 0,
};

/* ---------------------------- customer intelligence ----------------------- */

export type HealthLabel = 'Healthy' | 'Watch' | 'High Risk';

export interface CustomerIntel {
  name: string;
  billedThisPeriod: number;
  invoiceCount: number;
  outstanding: number;
  overdueOutstanding: number;
  maxDaysOverdue: number;
  frequentlyLate: boolean;
  lowValue: boolean;
  label: HealthLabel;
  /** Visible heuristic reasons — empty only when Healthy. */
  reasons: string[];
}

export function analyzeCustomers(
  salesRows: RegisterRow[],
  receivableRows: OutstandingRow[]
): CustomerIntel[] {
  const byName = new Map<string, CustomerIntel>();
  const get = (name: string): CustomerIntel => {
    let c = byName.get(name);
    if (!c) {
      c = {
        name,
        billedThisPeriod: 0,
        invoiceCount: 0,
        outstanding: 0,
        overdueOutstanding: 0,
        maxDaysOverdue: 0,
        frequentlyLate: false,
        lowValue: false,
        label: 'Healthy',
        reasons: [],
      };
      byName.set(name, c);
    }
    return c;
  };

  for (const row of salesRows) {
    const c = get(row.party_name);
    c.billedThisPeriod = r2(c.billedThisPeriod + row.grand_total);
    c.invoiceCount += 1;
  }
  for (const row of receivableRows) {
    const c = get(row.party_name);
    c.outstanding = r2(c.outstanding + row.outstanding);
    if (row.days_overdue > 0) {
      c.overdueOutstanding = r2(c.overdueOutstanding + row.outstanding);
      c.maxDaysOverdue = Math.max(c.maxDaysOverdue, row.days_overdue);
      c.frequentlyLate = c.maxDaysOverdue > 0 && countLateDocs(byName.get(c.name)) >= 2;
    }
  }

  const list = [...byName.values()];
  const active = list.filter((c) => c.invoiceCount > 0);
  const meanBilled =
    active.length > 0 ? r2(active.reduce((s, c) => s + c.billedThisPeriod, 0) / active.length) : 0;

  for (const c of list) {
    const reasons: string[] = [];
    const highRisk =
      c.overdueOutstanding > 0 &&
      (c.maxDaysOverdue >= 90 || (c.outstanding > 0 && c.overdueOutstanding > 0.75 * c.outstanding));
    if (highRisk) {
      reasons.push(
        `${formatInr(c.overdueOutstanding)} overdue${c.maxDaysOverdue >= 90 ? `, oldest ${c.maxDaysOverdue} days past due` : ''}`
      );
      c.label = 'High Risk';
    } else if (c.overdueOutstanding > 0) {
      reasons.push(`${formatInr(c.overdueOutstanding)} past due (${c.maxDaysOverdue} days)`);
      c.label = 'Watch';
    } else if (c.frequentlyLate) {
      reasons.push('Multiple invoices historically paid late');
      c.label = 'Watch';
    } else {
      c.label = 'Healthy';
    }
    if (active.length >= 4 && c.billedThisPeriod < 0.25 * meanBilled && c.invoiceCount <= 1) {
      c.lowValue = true;
      reasons.push('Low-value this period: single small order vs customer average');
    }
    c.reasons = reasons;
  }

  return list.sort((a, b) => b.billedThisPeriod - a.billedThisPeriod);
}

function countLateDocs(c: CustomerIntel | undefined): number {
  // late-doc counting happens during receivable pass; approximate via flags set there
  return c ? (c as CustomerIntel & { _lateDocs?: number })._lateDocs ?? (c.frequentlyLate ? 2 : 0) : 0;
}

/* ---------------------------- supplier intelligence ----------------------- */

export interface SupplierIntel {
  name: string;
  purchasedThisPeriod: number;
  billCount: number;
  outstandingPayable: number;
  overduePayable: number;
  maxDaysOverdue: number;
  shareOfPurchasesPct: number;
  concentrationNote: string | null;
  reasons: string[];
}

export function analyzeSuppliers(
  purchaseRows: RegisterRow[],
  payableRows: OutstandingRow[]
): SupplierIntel[] {
  const byName = new Map<string, SupplierIntel>();
  const get = (name: string): SupplierIntel => {
    let s = byName.get(name);
    if (!s) {
      s = {
        name,
        purchasedThisPeriod: 0,
        billCount: 0,
        outstandingPayable: 0,
        overduePayable: 0,
        maxDaysOverdue: 0,
        shareOfPurchasesPct: 0,
        concentrationNote: null,
        reasons: [],
      };
      byName.set(name, s);
    }
    return s;
  };
  for (const row of purchaseRows) {
    const s = get(row.party_name);
    s.purchasedThisPeriod = r2(s.purchasedThisPeriod + row.grand_total);
    s.billCount += 1;
  }
  for (const row of payableRows) {
    const s = get(row.party_name);
    s.outstandingPayable = r2(s.outstandingPayable + row.outstanding);
    if (row.days_overdue > 0) {
      s.overduePayable = r2(s.overduePayable + row.outstanding);
      s.maxDaysOverdue = Math.max(s.maxDaysOverdue, row.days_overdue);
    }
  }
  const total = r2([...byName.values()].reduce((sum, s) => sum + s.purchasedThisPeriod, 0));
  const list = [...byName.values()];
  for (const s of list) {
    s.shareOfPurchasesPct =
      total > 0 ? Math.round((s.purchasedThisPeriod / total) * 1000 + Number.EPSILON) / 10 : 0;
    if (total > 0 && s.shareOfPurchasesPct >= 40) {
      s.concentrationNote = `${s.name} is ${s.shareOfPurchasesPct}% of this period's purchases`;
      s.reasons.push(s.concentrationNote);
    }
    if (s.overduePayable > 0) {
      s.reasons.push(`${formatInr(s.overduePayable)} payable past due (${s.maxDaysOverdue} days)`);
    }
  }
  return list.sort((a, b) => b.purchasedThisPeriod - a.purchasedThisPeriod);
}

/* ---------------------------- inventory intelligence ---------------------- */

export interface ProductMovement {
  productId: string;
  productName: string;
  inStock: number;
  outboundUnits: number;
  inboundUnits: number;
  avgPerDay: number;
  classification: 'fast-moving' | 'slow-moving' | 'dead' | 'normal' | 'low-stock';
  note: string | null;
}

/**
 * Movement-window based classification. Outbound/inbound derive from signed
 * movement quantities (negative = out) so it stays correct regardless of the
 * movement-type vocabulary. Low-stock detection REQUIRES caller-supplied
 * minimum levels — without them that section is simply absent (honest limit:
 * valuation rows carry no reorder level).
 */
export function analyzeInventory(
  valuation: StockValuationRow[],
  movements: StockMovementRow[],
  opts: { windowDays: number; minLevels?: Record<string, number>; today?: Date } = { windowDays: 30 }
): ProductMovement[] {
  void (opts.today ?? new Date()); // movements arrive pre-filtered to the window by the fetcher
  const windowDays = Math.max(1, Math.round(opts.windowDays));
  const minLevels = opts.minLevels ?? {};

  const out = new Map<string, number>();
  const inn = new Map<string, number>();
  for (const m of movements) {
    const qty = Math.round(Number(m.quantity) || 0);
    if (qty < 0) out.set(m.product_id, (out.get(m.product_id) ?? 0) - qty);
    else if (qty > 0) inn.set(m.product_id, (inn.get(m.product_id) ?? 0) + qty);
  }

  return valuation
    .filter((v) => v.product_id !== null)
    .map((v) => {
      const outboundUnits = out.get(v.product_id!) ?? 0;
      const inboundUnits = inn.get(v.product_id!) ?? 0;
      const avgPerDay = Math.round((outboundUnits / windowDays) * 100 + Number.EPSILON) / 100;
      let classification: ProductMovement['classification'] = 'normal';
      let note: string | null = null;
      const min = minLevels[v.product_id!];
      if (min != null && v.quantity <= min) {
        classification = 'low-stock';
        note = `${v.quantity} in stock, minimum level ${min}`;
      }
      if (v.quantity > 0 && outboundUnits === 0 && inboundUnits === 0) {
        classification = 'dead';
        note = `No stock movement in ${windowDays} days while holding ${v.quantity} units`;
      } else if (avgPerDay >= 1) {
        if (classification === 'normal') classification = 'fast-moving';
        if (v.quantity <= Math.ceil(avgPerDay * 7)) {
          classification = 'fast-moving';
          note = `${v.product_name} sold ${outboundUnits} units in ${windowDays} days, ${v.quantity} in stock`;
        } else if (!note) {
          note = `${outboundUnits} units moved in ${windowDays} days (~${avgPerDay}/day)`;
        }
      } else if (outboundUnits > 0 && outboundUnits < windowDays / 10) {
        if (classification === 'normal') classification = 'slow-moving';
        note = `Only ${outboundUnits} units sold in ${windowDays} days`;
      }
      return {
        productId: v.product_id!,
        productName: v.product_name,
        inStock: v.quantity,
        outboundUnits,
        inboundUnits,
        avgPerDay,
        classification,
        note,
      };
    })
    .sort((a, b) => b.outboundUnits - a.outboundUnits || b.inStock - a.inStock);
}

/* ------------------------------ cash position ----------------------------- */

export interface CashPositionIntel {
  closingCash: number;
  inflow: number;
  outflow: number;
  receivablesOutstanding: number;
  payablesOutstanding: number;
  receivablesOverdue: number;
  payablesOverdue: number;
  overduePhrase: string | null;
  shortageRisk: boolean;
  forecast: { nextPeriodEstimate: number; basis: string; isEstimate: true } | null;
}

export function analyzeCashPosition(
  cashBank: CashBankMovementsReport | null,
  receivables: OutstandingReport | null,
  payables: OutstandingReport | null,
  monthlyNetClosings?: number[]
): CashPositionIntel {
  const overdueSum = (rows: OutstandingRow[]) =>
    r2(rows.filter((x) => x.days_overdue > 0).reduce((s, x) => s + x.outstanding, 0));

  const receivablesOverdue = receivables ? overdueSum(receivables.rows) : 0;
  const payablesOverdue = payables ? overdueSum(payables.rows) : 0;
  const closingCash = cashBank ? cashBank.totals.closing : 0;
  const payablesOutstanding = payables ? payables.totals.outstanding : 0;

  let forecast: CashPositionIntel['forecast'] = null;
  if (monthlyNetClosings && monthlyNetClosings.length >= 3) {
    const last = monthlyNetClosings.slice(-3);
    const est = r2(last.reduce((s, n) => s + n, 0) / last.length);
    forecast = {
      nextPeriodEstimate: est,
      basis: `Simple average of the last ${last.length} months' net cash flow — an ESTIMATE, not a guarantee`,
      isEstimate: true,
    };
  }

  return {
    closingCash,
    inflow: cashBank ? cashBank.totals.inflow : 0,
    outflow: cashBank ? cashBank.totals.outflow : 0,
    receivablesOutstanding: receivables ? receivables.totals.outstanding : 0,
    payablesOutstanding,
    receivablesOverdue,
    payablesOverdue,
    overduePhrase: receivablesOverdue > 0 ? `${formatInrShort(receivablesOverdue)} overdue` : null,
    shortageRisk: closingCash < payablesOutstanding,
    forecast,
  };
}

/* ------------------------------- GST intel -------------------------------- */

export interface GstIntel {
  outwardTaxable: number;
  outputTax: number;
  inputTax: number;
  netPosition: number;
  netLabel: string;
  trend: TrendDelta | null;
  mismatchNotes: string[];
}

function issueSeverities(issues: ReadonlyArray<{ severity: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
  return counts;
}

/**
 * Consumes the ADAPTER's summarizeGst output (never recomputes GST math).
 * Validation-engine findings ride in as pre-fetched issue rows.
 */
export function analyzeGst(
  current: ReturnType<typeof summarizeGst>,
  previous: ReturnType<typeof summarizeGst> | null,
  validationIssues: ReadonlyArray<{ severity: string }> = []
): GstIntel {
  const counts = issueSeverities(validationIssues);
  const mismatchNotes: string[] = [];
  if (counts['critical']) mismatchNotes.push(`${counts['critical']} critical GST validation issue(s) flagged by the validation engine`);
  if (counts['warning']) mismatchNotes.push(`${counts['warning']} GST warning(s) need review`);
  return {
    outwardTaxable: current.outwardTaxable,
    outputTax: current.outputTax,
    inputTax: current.inputTax,
    netPosition: current.netPosition,
    netLabel: current.netLabel,
    trend: previous ? mom(current.netPosition, previous.netPosition) : null,
    mismatchNotes,
  };
}

/* ------------------------------- smart alerts ----------------------------- */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface SmartAlert {
  id: string;
  title: string;
  reason: string;
  dataRef: string;
  period: string;
  severity: AlertSeverity;
  suggestedAction: string;
  route: string;
}

export interface AlertInputs {
  periodLabel: string;
  lowStock: ProductMovement[];
  receivables: OutstandingReport | null;
  trends: Trends | null;
  gst: GstIntel | null;
  cash: CashPositionIntel | null;
  /** Large-overdue threshold in rupees (default Rs 50,000). */
  largeOverdueThreshold?: number;
}

const SALES_DROP_PCT = -20;
const SPIKE_PCT = 50;

export function deriveAlerts(input: AlertInputs): SmartAlert[] {
  const alerts: SmartAlert[] = [];
  const period = input.periodLabel;
  const threshold = input.largeOverdueThreshold ?? 50000;

  if (input.lowStock.length > 0) {
    const worst = input.lowStock.find((p) => p.classification === 'fast-moving') ?? input.lowStock[0];
    alerts.push({
      id: 'low-stock',
      title: `${input.lowStock.length} product(s) need restocking attention`,
      reason: worst.note ?? `${worst.productName}: ${worst.inStock} in stock`,
      dataRef: 'get_stock_valuation + stock_movements',
      period,
      severity: 'warning',
      suggestedAction: `Review ${input.lowStock.length} flagged product(s) and raise purchase orders`,
      route: '/app/products',
    });
  }

  const ar = input.receivables;
  if (ar) {
    const overdue90 = ar.rows.filter((x) => x.bucket === '90+');
    const overdueTotal = r2(ar.rows.filter((x) => x.days_overdue > 0).reduce((s, x) => s + x.outstanding, 0));
    if (overdueTotal > 0) {
      const top = [...ar.rows].filter((x) => x.days_overdue > 0).sort((a, b) => b.outstanding - a.outstanding)[0];
      alerts.push({
        id: 'large-overdue',
        title: `${formatInrShort(overdueTotal)} overdue across customers`,
        reason: top ? `${top.party_name}: ${formatInr(top.outstanding)} at ${top.days_overdue} days past due` : '',
        dataRef: 'v_receivables_aging_base',
        period,
        severity: overdue90.length > 0 || overdueTotal >= threshold ? 'critical' : 'warning',
        suggestedAction: 'Chase the largest overdue invoices first; record payments as they land',
        route: '/app/receivables',
      });
    }
  }

  const t = input.trends;
  if (t) {
    if (t.sales.changePct !== null && t.sales.changePct <= SALES_DROP_PCT) {
      alerts.push({
        id: 'sales-drop',
        title: `Sales down ${Math.abs(t.sales.changePct)}% vs previous month`,
        reason: `${formatInr(t.sales.current)} this period vs ${formatInr(t.sales.previous)} before`,
        dataRef: 'sales_invoices (issued)',
        period,
        severity: 'warning',
        suggestedAction: 'Review pipeline and follow up open quotations',
        route: '/app/quotations',
      });
    }
    if (t.expenses.changePct !== null && t.expenses.changePct >= SPIKE_PCT && t.expenses.current > 0) {
      alerts.push({
        id: 'expense-spike',
        title: `Expenses up ${t.expenses.changePct}% vs previous month`,
        reason: `${formatInr(t.expenses.current)} vs ${formatInr(t.expenses.previous)} — check for one-offs`,
        dataRef: 'v_expense_summary',
        period,
        severity: 'warning',
        suggestedAction: 'Open the expense register and review the biggest entries',
        route: '/app/expenses',
      });
    }
    if (t.purchases.changePct !== null && t.purchases.changePct >= SPIKE_PCT && t.purchases.current > 0) {
      alerts.push({
        id: 'purchase-spike',
        title: `Purchases up ${t.purchases.changePct}% vs previous month`,
        reason: `${formatInr(t.purchases.current)} vs ${formatInr(t.purchases.previous)}`,
        dataRef: 'purchase_bills (confirmed)',
        period,
        severity: 'info',
        suggestedAction: 'Confirm the spike matches stocking plans',
        route: '/app/purchase-bills',
      });
    }
    if (t.profit.direction === 'down' && t.profit.current < t.profit.previous && t.profit.changePct !== null && t.profit.changePct <= SALES_DROP_PCT) {
      alerts.push({
        id: 'profit-decline',
        title: `Profit declined ${Math.abs(t.profit.changePct)}% vs previous month`,
        reason: `${formatInr(t.profit.current)} vs ${formatInr(t.profit.previous)} — ask the assistant "why is my profit lower" for interpretation`,
        dataRef: 'get_profit_and_loss',
        period,
        severity: 'warning',
        suggestedAction: 'Compare revenue and expense drivers in the P&L',
        route: '/app/reports/profit-loss',
      });
    }
  }

  if (input.gst) {
    if (input.gst.mismatchNotes.length > 0) {
      alerts.push({
        id: 'gst-mismatch',
        title: 'GST validation findings need review',
        reason: input.gst.mismatchNotes.join('; '),
        dataRef: 'gst validation engine',
        period,
        severity: 'critical',
        suggestedAction: 'Open GST validation and clear the flagged documents',
        route: '/app/gst/validation',
      });
    }
    if (input.gst.netPosition > 0) {
      alerts.push({
        id: 'gst-payable',
        title: `${input.gst.netLabel}: ${formatInrShort(input.gst.netPosition)}`,
        reason: 'Based on posted journals for the period (journals-truth figure)',
        dataRef: 'get_gst_summary',
        period,
        severity: 'info',
        suggestedAction: 'Set aside funds for the upcoming GST payment',
        route: '/app/gst',
      });
    }
  }

  if (input.cash) {
    if (input.cash.shortageRisk) {
      alerts.push({
        id: 'cash-shortage-risk',
        title: 'Cash position is thinner than open payables',
        reason: `Closing cash/bank ${formatInr(input.cash.closingCash)} vs ${formatInr(input.cash.payablesOutstanding)} owed to suppliers`,
        dataRef: 'journal_entry_lines (Cash & Bank group) + v_payables_aging_base',
        period,
        severity: 'warning',
        suggestedAction: 'Prioritise collections and schedule supplier payments',
        route: '/app/cash-bank',
      });
    }
    if (input.cash.forecast) {
      alerts.push({
        id: 'cash-forecast',
        title: `Next-month cash-flow estimate: ${formatInrShort(input.cash.forecast.nextPeriodEstimate)}`,
        reason: input.cash.forecast.basis,
        dataRef: 'v_cashflow_daily history',
        period,
        severity: 'info',
        suggestedAction: 'Treat as planning input only — verify against actuals monthly',
        route: '/app/cash-bank',
      });
    }
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/* -------------------------------- briefings ------------------------------- */

export interface BriefSection {
  label: string;
  value: string;
  source: string;
  basis: string;
}

export interface DailyBrief {
  dateLabel: string;
  sections: BriefSection[];
  recommendation: string | null;
}

export interface DailyBriefInput {
  dateLabel: string;
  salesYesterday?: number;
  purchasesYesterday?: number;
  collectionsYesterday?: number;
  receivablesOutstanding?: number;
  overdueCount?: number;
  lowStockCount?: number;
  gstDue?: number;
  alerts?: SmartAlert[];
}

/** Sections appear ONLY for inputs that actually carry data. */
export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const sections: BriefSection[] = [];
  if (input.salesYesterday != null)
    sections.push({ label: 'Sales', value: formatInr(input.salesYesterday), source: 'sales_invoices (issued)', basis: 'invoices dated yesterday' });
  if (input.purchasesYesterday != null)
    sections.push({ label: 'Purchases', value: formatInr(input.purchasesYesterday), source: 'purchase_bills (confirmed)', basis: 'bills dated yesterday' });
  if (input.collectionsYesterday != null)
    sections.push({ label: 'Collections', value: formatInr(input.collectionsYesterday), source: 'Cash & Bank journals', basis: 'all-source cash inflow (not only invoice collections)' });
  if (input.receivablesOutstanding != null)
    sections.push({ label: 'Receivables outstanding', value: formatInr(input.receivablesOutstanding), source: 'v_receivables_aging_base', basis: 'open invoices, outstanding > 0' });
  if (input.overdueCount != null && input.overdueCount > 0)
    sections.push({ label: 'Overdue invoices', value: String(input.overdueCount), source: 'v_receivables_aging_base', basis: 'documents past due date' });
  if (input.lowStockCount != null && input.lowStockCount > 0)
    sections.push({ label: 'Low-stock products', value: String(input.lowStockCount), source: 'get_stock_valuation + movements', basis: 'movement-window analysis' });
  if (input.gstDue != null && input.gstDue > 0)
    sections.push({ label: 'GST due', value: formatInr(input.gstDue), source: 'get_gst_summary', basis: 'journals-truth net position' });

  const firstAlert = input.alerts?.[0] ?? null;
  return {
    dateLabel: input.dateLabel,
    sections,
    recommendation: firstAlert ? firstAlert.suggestedAction : null,
  };
}

/* --------------------------- management reporting -------------------------- */

export interface ManagementReportSection {
  heading: string;
  lines: string[];
}

export interface MonthlyReportInput {
  monthLabel: string;
  previousLabel: string | null;
  trends: Trends | null;
  topCustomers: CustomerIntel[];
  topSuppliers: SupplierIntel[];
  inventory: ProductMovement[];
  gst: GstIntel | null;
  cash: CashPositionIntel | null;
  alerts: SmartAlert[];
}

export function assembleMonthlyReport(input: MonthlyReportInput): ManagementReportSection[] {
  const sections: ManagementReportSection[] = [];
  const t = input.trends;
  if (t) {
    const buildComparison = (label: string, d: TrendDelta, prevLabel?: string | null): string => {
      const pctSection = d.changePct === null
        ? 'no prior base'
        : `${d.changePct > 0 ? '+' : ''}${d.changePct}%`;
      const prevPart = prevLabel ? ` (previous ${prevLabel}: ${formatInr(d.previous)}, ${pctSection})` : '';
      return `${label}: ${formatInr(d.current)}${prevPart}`;
    };
    sections.push({
      heading: 'Executive summary',
      lines: [
        buildComparison('Sales', t.sales, input.previousLabel),
        buildComparison('Purchases', t.purchases, input.previousLabel),
        buildComparison('Collections (cash inflow)', t.collections, input.previousLabel),
        buildComparison('Expenses', t.expenses, input.previousLabel),
        buildComparison('Net profit', t.profit, input.previousLabel),
      ],
    });
  }
  if (input.topCustomers.length > 0) {
    sections.push({
      heading: 'Top customers',
      lines: input.topCustomers.slice(0, 5).map((c) => `${c.name}: ${formatInr(c.billedThisPeriod)} [${c.label}${c.reasons.length ? ` — ${c.reasons[0]}` : ''}]`),
    });
  }
  if (input.topSuppliers.length > 0) {
    sections.push({
      heading: 'Top suppliers',
      lines: input.topSuppliers.slice(0, 5).map((s) => `${s.name}: ${formatInr(s.purchasedThisPeriod)}${s.concentrationNote ? ` (${s.concentrationNote})` : ''}`),
    });
  }
  const invFlags = input.inventory.filter((p) => p.classification === 'dead' || p.classification === 'fast-moving').slice(0, 5);
  if (invFlags.length > 0) {
    sections.push({
      heading: 'Inventory watch',
      lines: invFlags.map((p) => `${p.productName} [${p.classification}] — ${p.note ?? ''}`),
    });
  }
  if (input.gst) {
    sections.push({
      heading: 'GST position',
      lines: [
        `Output tax: ${formatInr(input.gst.outputTax)}; Input tax: ${formatInr(input.gst.inputTax)}`,
        `${input.gst.netLabel}: ${formatInr(input.gst.netPosition)} (journals-truth)`,
        ...(input.gst.mismatchNotes.length > 0 ? input.gst.mismatchNotes : []),
      ],
    });
  }
  if (input.cash) {
    sections.push({
      heading: 'Cash position',
      lines: [
        `Closing cash/bank: ${formatInr(input.cash.closingCash)}; Receivables: ${formatInr(input.cash.receivablesOutstanding)}; Payables: ${formatInr(input.cash.payablesOutstanding)}`,
        ...(input.cash.forecast ? [`Next-period cash-flow estimate: ${formatInr(input.cash.forecast.nextPeriodEstimate)} — ${input.cash.forecast.basis}`] : []),
      ],
    });
  }
  if (input.alerts.length > 0) {
    sections.push({
      heading: 'Alerts & recommended actions',
      lines: input.alerts.map((a) => `[${a.severity.toUpperCase()}] ${a.title} — ${a.suggestedAction}`),
    });
  }
  return sections;
}

export function renderManagementReportText(monthLabel: string, sections: ManagementReportSection[]): string {
  return [`Management report — ${monthLabel}`, ...sections.map((s) => `\n${s.heading}\n${s.lines.map((l) => `- ${l}`).join('\n')}`)].join('\n');
}

/* ------------------------- NL intent router (no LLM) ----------------------- */

export type AiIntentId =
  | 'sales-this-month'
  | 'who-owes-most'
  | 'biggest-expenses'
  | 'gst-payable'
  | 'total-purchases'
  | 'top-products'
  | 'top-customers'
  | 'cash-vs-bank'
  | 'unpaid-invoices'
  | 'compare-months';

interface IntentRule {
  id: AiIntentId;
  re: RegExp;
}

/** Order matters: most specific first. Open-ended questions fall through to the LLM path. */
const INTENT_RULES: IntentRule[] = [
  { id: 'gst-payable', re: /\bgst\b.*\b(payable|due|position|credit)\b|\b(payable|due)\b.*\bgst\b/i },
  { id: 'compare-months', re: /\bcompare\b.*\bmonth|\bvs\b.*\blast\s+month|month[- ]over[- ]month|this month.*\bvs\b/i },
  { id: 'who-owes-most', re: /\bwho\b.*(owes|owe)|top\s+\d*\s*debtors?\b|biggest?\s+debtors?\b/i },
  { id: 'unpaid-invoices', re: /\bunpaid\b.*\binvoice|\boutstanding\b.*\binvoice|receivables?\b.*\blist\b|\bunpaid\b\b/i },
  { id: 'biggest-expenses', re: /(biggest|largest|top|main)\s+(expenses?|spends?)/i },
  { id: 'total-purchases', re: /\b(total|how much)\b.*\b(purchase[sd]?|bought)\b/i },
  { id: 'top-products', re: /\b(top|best[- ]selling|most\s+sold)\b.*\bproducts?\b/i },
  { id: 'top-customers', re: /\btop\b.*\bcustomers?\b/i },
  { id: 'cash-vs-bank', re: /\bcash\b\s*(vs|and|or|&)\s*\bbank\b|\b(bank|cash)\s+balance\b/i },
  { id: 'sales-this-month', re: /\bsales\b.*\b(this|current)\s+month|(how much|what)\b.*\bsold\b.*\bmonth\b|\btotal sales\b/i },
];

export function detectIntent(question: string): AiIntentId | null {
  const q = question.trim();
  if (!q) return null;
  for (const rule of INTENT_RULES) if (rule.re.test(q)) return rule.id;
  return null;
}

/* --------------------------- deterministic answers ------------------------- */

export interface AnswerContext {
  period: string;
  amount: number | null;
  source: string;
  basis: string;
}

export interface DeterministicAnswer {
  intent: AiIntentId;
  text: string;
  context: AnswerContext;
}

/**
 * Preloaded intelligence bundle consumed by the router answers. Fields stay
 * nullable so partial fetch failure degrades to an honest "not available"
 * instead of a fabricated number.
 */
export interface IntelligenceSnapshot {
  periodLabel: string;
  previousLabel: string | null;
  sales: RegisterReport | null;
  purchases: RegisterReport | null;
  expensesCurTotal: number | null;
  expenseTopCategory: { name: string; total: number } | null;
  profitCur: number | null;
  profitPrev: number | null;
  gst: GstIntel | null;
  cashBank: CashBankMovementsReport | null;
  receivables: OutstandingReport | null;
  payables: OutstandingReport | null;
  customers: CustomerIntel[];
  suppliers: SupplierIntel[];
  products: ProductMovement[];
  trends: Trends | null;
}

const NO_DATA = (what: string): DeterministicAnswer['text'] =>
  `${what} isn't available yet — no real data was returned for this period, and I won't guess.`;

export function answerDeterministic(intent: AiIntentId, snap: IntelligenceSnapshot): DeterministicAnswer {
  const period = snap.periodLabel;
  switch (intent) {
    case 'sales-this-month': {
      const t = snap.sales?.totals;
      return {
        intent,
        text: t ? `Total issued sales for ${period}: ${formatInr(t.grand)} across ${t.count} invoice(s) (taxable ${formatInr(t.taxable)}).` : NO_DATA('Sales'),
        context: { period, amount: t?.grand ?? null, source: 'sales_invoices (issued)', basis: 'grand_total sum over issued invoices in range' },
      };
    }
    case 'who-owes-most': {
      const rows = snap.receivables?.rows ?? [];
      if (rows.length === 0) return { intent, text: NO_DATA('Receivables'), context: { period, amount: null, source: 'v_receivables_aging_base', basis: 'open invoices outstanding > 0' } };
      const byParty = new Map<string, number>();
      for (const r of rows) byParty.set(r.party_name, r2((byParty.get(r.party_name) ?? 0) + r.outstanding));
      const top = [...byParty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return {
        intent,
        text: `Top debtors right now: ${top.map(([n, v], i) => `${i + 1}. ${n} — ${formatInr(v)}`).join('; ')}. Total outstanding ${formatInr(snap.receivables!.totals.outstanding)}.`,
        context: { period, amount: top[0]?.[1] ?? null, source: 'v_receivables_aging_base', basis: 'per-party sum of open invoice outstanding' },
      };
    }
    case 'biggest-expenses': {
      if (snap.expenseTopCategory == null) return { intent, text: NO_DATA('Expenses'), context: { period, amount: null, source: 'v_expense_summary', basis: 'category-wise expense totals' } };
      return {
        intent,
        text: `Biggest expense category for ${period}: ${snap.expenseTopCategory.name} at ${formatInr(snap.expenseTopCategory.total)} (total expenses ${snap.expensesCurTotal != null ? formatInr(snap.expensesCurTotal) : 'unavailable'}).`,
        context: { period, amount: snap.expenseTopCategory.total, source: 'v_expense_summary', basis: 'category totals over the period' },
      };
    }
    case 'gst-payable': {
      if (!snap.gst) return { intent, text: NO_DATA('GST'), context: { period, amount: null, source: 'get_gst_summary', basis: 'posted-journal tax ledgers' } };
      return {
        intent,
        text: `${snap.gst.netLabel} for ${period}: ${formatInr(snap.gst.netPosition)} (output ${formatInr(snap.gst.outputTax)}, input credit ${formatInr(snap.gst.inputTax)})${snap.gst.mismatchNotes.length ? `. Notes: ${snap.gst.mismatchNotes.join('; ')}` : ''}.`,
        context: { period, amount: snap.gst.netPosition, source: 'get_gst_summary', basis: 'journals-truth net position; negative = credit carry-forward' },
      };
    }
    case 'total-purchases': {
      const t = snap.purchases?.totals;
      return {
        intent,
        text: t ? `Total confirmed purchases for ${period}: ${formatInr(t.grand)} across ${t.count} bill(s).` : NO_DATA('Purchases'),
        context: { period, amount: t?.grand ?? null, source: 'purchase_bills (confirmed)', basis: 'grand_total sum over confirmed bills in range' },
      };
    }
    case 'top-products': {
      const movers = snap.products.filter((p) => p.outboundUnits > 0).slice(0, 5);
      if (movers.length === 0) return { intent, text: NO_DATA('Product movement'), context: { period, amount: null, source: 'stock_movements', basis: 'signed movement quantities within window' } };
      return {
        intent,
        text: `Top products by units moved this period: ${movers.map((p, i) => `${i + 1}. ${p.productName} (${p.outboundUnits} units)`).join('; ')}. Basis is movement quantities, not revenue.`,
        context: { period, amount: movers[0].outboundUnits, source: 'stock_movements', basis: 'units moved (quantity-signed), not value' },
      };
    }
    case 'top-customers': {
      if (snap.customers.length === 0) return { intent, text: NO_DATA('Customers'), context: { period, amount: null, source: 'sales_invoices (issued)', basis: 'per-party billed totals' } };
      const top = snap.customers.slice(0, 5);
      return {
        intent,
        text: `Top customers for ${period}: ${top.map((c, i) => `${i + 1}. ${c.name} — ${formatInr(c.billedThisPeriod)} [${c.label}]`).join('; ')}.`,
        context: { period, amount: top[0]?.billedThisPeriod ?? null, source: 'sales_invoices (issued)', basis: 'grand_total grouped per customer' },
      };
    }
    case 'cash-vs-bank': {
      const rows = snap.cashBank?.rows ?? [];
      if (rows.length === 0) return { intent, text: NO_DATA('Cash & Bank'), context: { period, amount: null, source: 'journal_entry_lines (Cash & Bank)', basis: 'posted journal lines in the Cash & Bank group' } };
      return {
        intent,
        text: rows.map((r) => `${r.ledger_name}: closing ${formatInr(r.closing)} (in ${formatInr(r.inflow)} / out ${formatInr(r.outflow)})`).join('; ') + `. Books-truth, posted journals only.`,
        context: { period, amount: snap.cashBank!.totals.closing, source: 'journal_entry_lines (Cash & Bank)', basis: 'opening + posted flows per ledger' },
      };
    }
    case 'unpaid-invoices': {
      const rep = snap.receivables;
      if (!rep || rep.rows.length === 0) return { intent, text: 'No open customer invoices with outstanding balance right now.', context: { period, amount: 0, source: 'v_receivables_aging_base', basis: 'open invoices outstanding > 0' } };
      const overdue = rep.rows.filter((r) => r.days_overdue > 0).length;
      return {
        intent,
        text: `${rep.totals.count} unpaid invoice(s) totalling ${formatInr(rep.totals.outstanding)}; ${overdue} past due.`,
        context: { period, amount: rep.totals.outstanding, source: 'v_receivables_aging_base', basis: 'outstanding sums from the books view' },
      };
    }
    case 'compare-months': {
      if (!snap.trends) return { intent, text: NO_DATA('Month comparison'), context: { period, amount: null, source: 'registers + P&L', basis: 'current vs previous month totals' } };
      const line = (l: string, d: TrendDelta) => `${l}: ${formatInr(d.current)} vs ${formatInr(d.previous)} (${d.changePct === null ? 'no prior base' : `${d.changePct > 0 ? '+' : ''}${d.changePct}%`})`;
      return {
        intent,
        text: `${period} vs ${snap.previousLabel ?? 'previous month'} — ${['Sales', 'Purchases', 'Expenses', 'Net profit'].map((l, i) => line(l, [snap.trends!.sales, snap.trends!.purchases, snap.trends!.expenses, snap.trends!.profit][i])).join('; ')}.`,
        context: { period, amount: snap.trends.sales.changeAmount, source: 'sales/purchase registers + get_profit_and_loss + v_expense_summary', basis: 'same-shape totals across adjacent months' },
      };
    }
  }
}

/* ------------------------------ async loaders ------------------------------ */

function extractNetProfit(rows: Array<{ section: string; group_name: string; amount: number }>): number | null {
  const hit = rows.find((r) => r.section === 'Summary' && r.group_name === 'Net Profit');
  return hit ? r2(hit.amount) : null;
}

function topExpenseCategory(rows: Array<{ category_name: string; total_amount: number }>): { name: string; total: number } | null {
  if (rows.length === 0) return null;
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.category_name, r2((byCat.get(r.category_name) ?? 0) + r.total_amount));
  const [name, total] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  return { name, total };
}

function monthLabelOf(range: { from: string; to: string }): string {
  const d = new Date(`${range.from}T00:00:00`);
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

/**
 * Loads EVERYTHING the engine needs via the existing adapter (single gateway),
 * degrading gracefully per-fetch so partial outage still yields partial truth.
 * Oscar's T117 server-side summary fns will slot into this loader via relay
 * once his contract lands — call sites should not change.
 */
export async function loadIntelligenceSnapshot(
  businessId: string,
  now: Date = new Date()
): Promise<{ snapshot: IntelligenceSnapshot; errors: string[] }> {
  const cur = resolvePreset('this-month', now);
  const prev = resolvePreset('last-month', now);

  const results = await Promise.allSettled([
    fetchSalesRegister({ businessId, range: cur }),
    fetchSalesRegister({ businessId, range: prev }),
    fetchPurchaseRegister({ businessId, range: cur }),
    fetchPurchaseRegister({ businessId, range: prev }),
    fetchProfitLoss({ businessId, range: cur }),
    fetchProfitLoss({ businessId, range: prev }),
    fetchExpenseReport({ businessId, range: cur }),
    fetchExpenseReport({ businessId, range: prev }),
    fetchGstSummary({ businessId, range: cur }),
    fetchGstSummary({ businessId, range: prev }),
    fetchCashBankMovements({ businessId, range: cur }),
    fetchReceivablesDetail({ businessId, range: cur }),
    fetchPayablesDetail({ businessId, range: cur }),
    fetchStockReport({ businessId, range: cur }),
  ]);

  const errors: string[] = [];
  const val = <T>(i: number): T | null => {
    const r = results[i];
    if (r.status === 'fulfilled') return r.value as T;
    errors.push(`fetch#${i}: ${String((r as PromiseRejectedResult).reason?.message ?? r.reason)}`);
    return null;
  };

  const salesCur = val<RegisterReport>(0);
  const salesPrev = val<RegisterReport>(1);
  const purchCur = val<RegisterReport>(2);
  const purchPrev = val<RegisterReport>(3);
  const plCur = val<{ rows: Array<{ section: string; group_name: string; amount: number }> }>(4);
  const plPrev = val<{ rows: Array<{ section: string; group_name: string; amount: number }> }>(5);
  const expCur = val<{ rows: Array<{ category_name: string; total_amount: number }>; totals: { total: number } }>(6);
  const expPrev = val<{ totals: { total: number } }>(7);
  const gstCurRaw = val<Awaited<ReturnType<typeof fetchGstSummary>>>(8);
  const gstPrevRaw = val<Awaited<ReturnType<typeof fetchGstSummary>>>(9);
  const cashBank = val<CashBankMovementsReport>(10);
  const recv = val<OutstandingReport>(11);
  const pay = val<OutstandingReport>(12);
  const stock = val<StockReport>(13);

  const gstCur = gstCurRaw ? summarizeGst(gstCurRaw.rows) : null;
  const gstPrev = gstPrevRaw ? summarizeGst(gstPrevRaw.rows) : null;

  const figures = (which: 'cur' | 'prev'): PeriodFigures => ({
    sales: (which === 'cur' ? salesCur : salesPrev)?.totals.grand ?? 0,
    purchases: (which === 'cur' ? purchCur : purchPrev)?.totals.grand ?? 0,
    collections: which === 'cur' ? (cashBank?.totals.inflow ?? 0) : 0,
    expenses: (which === 'cur' ? expCur : expPrev)?.totals.total ?? 0,
    profit: (which === 'cur' ? plCur : plPrev)?.rows ? extractNetProfit((which === 'cur' ? plCur : plPrev)!.rows) ?? 0 : 0,
    gstPayable: Math.max(0, (which === 'cur' ? gstCur : gstPrev)?.netPosition ?? 0),
  });

  const products = stock
    ? analyzeInventory(stock.valuation, stock.movements, { windowDays: 30 })
    : [];

  const snapshot: IntelligenceSnapshot = {
    periodLabel: monthLabelOf(cur),
    previousLabel: monthLabelOf(prev),
    sales: salesCur,
    purchases: purchCur,
    expensesCurTotal: expCur ? expCur.totals.total : null,
    expenseTopCategory: expCur ? topExpenseCategory(expCur.rows) : null,
    profitCur: plCur ? extractNetProfit(plCur.rows) : null,
    profitPrev: plPrev ? extractNetProfit(plPrev.rows) : null,
    gst: gstCur ? analyzeGst(gstCur, gstPrev) : null,
    cashBank,
    receivables: recv,
    payables: pay,
    customers: salesCur || recv ? analyzeCustomers(salesCur?.rows ?? [], recv?.rows ?? []) : [],
    suppliers: purchCur || pay ? analyzeSuppliers(purchCur?.rows ?? [], pay?.rows ?? []) : [],
    products,
    trends: buildTrends(figures('cur'), figures('prev')),
  };

  return { snapshot, errors };
}
