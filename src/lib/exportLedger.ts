import {
  fetchBalanceSheet,
  fetchCashFlow,
  fetchDayBook,
  fetchGstSummary,
  fetchAging,
  fetchProfitLoss,
  getFiscalYear,
  toISODate,
} from '@/lib/reportsAdapter';

/**
 * Full-ledger export assembler. Reads ONLY through the existing
 * reportsAdapter fetchers (single data gateway) — no direct table queries.
 * Excel = CSV per ruling: no SheetJS dependency.
 */

export interface FullLedgerExport {
  generatedAt: string;
  businessId: string;
  fiscalYear: string;
  range: { from: string; to: string };
  sections: {
    dayBook: Awaited<ReturnType<typeof fetchDayBook>>['entries'];
    profitLoss: Awaited<ReturnType<typeof fetchProfitLoss>>['rows'];
    balanceSheet: Awaited<ReturnType<typeof fetchBalanceSheet>>['rows'];
    cashFlowDaily: Awaited<ReturnType<typeof fetchCashFlow>>['daily'];
    gstSummary: Awaited<ReturnType<typeof fetchGstSummary>>['rows'];
    receivablesAging: Awaited<ReturnType<typeof fetchAging>>['rows'];
    payablesAging: Awaited<ReturnType<typeof fetchAging>>['rows'];
  };
}

export async function buildFullLedgerJson(businessId: string, now: Date = new Date()): Promise<FullLedgerExport> {
  const fy = getFiscalYear(now);
  const range = { from: toISODate(fy.start), to: toISODate(fy.end) };

  const [dayBook, profitLoss, balanceSheet, cashFlow, gstSummary, arAging, apAging] = await Promise.all([
    fetchDayBook({ businessId, range }),
    fetchProfitLoss({ businessId, range }),
    fetchBalanceSheet({ businessId, asOf: range.to }),
    fetchCashFlow({ businessId, range }),
    fetchGstSummary({ businessId, range }),
    fetchAging({ businessId, asOf: range.to, side: 'receivable' }),
    fetchAging({ businessId, asOf: range.to, side: 'payable' }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    businessId,
    fiscalYear: fy.label,
    range,
    sections: {
      dayBook: dayBook.entries,
      profitLoss: profitLoss.rows,
      balanceSheet: balanceSheet.rows,
      cashFlowDaily: cashFlow.daily,
      gstSummary: gstSummary.rows,
      receivablesAging: arAging.rows,
      payablesAging: apAging.rows,
    },
  };
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const escapeCell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escapeCell(r[c])).join(','));
  return [header, ...body].join('\r\n');
}

export function downloadLedgerCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]): void {
  const blob = new Blob(['\ufeff' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
