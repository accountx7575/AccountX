import { describe, it, expect } from 'vitest';
import {
  toISODate,
  getFiscalYear,
  resolvePreset,
  summarizeAging,
  fetchGstSummary,
  fetchProfitLoss,
  fetchExpenseReport,
  fetchStockReport,
  ReportNotReadyError,
  REPORT_REGISTRY,
  type AgingDocRow,
} from './reportsAdapter';

describe('toISODate', () => {
  it('formats local dates without UTC day-shift', () => {
    expect(toISODate(new Date(2026, 0, 15))).toBe('2026-01-15');
    expect(toISODate(new Date(2026, 2, 31))).toBe('2026-03-31');
    expect(toISODate(new Date(2026, 11, 1))).toBe('2026-12-01');
  });
});

describe('getFiscalYear (Indian FY, Apr–Mar)', () => {
  it('maps Jan–Mar into the FY that started the previous calendar year', () => {
    const fy = getFiscalYear(new Date(2026, 1, 10));
    expect(fy.start.getFullYear()).toBe(2025);
    expect(fy.start.getMonth()).toBe(3);
    expect(fy.end.getFullYear()).toBe(2026);
    expect(fy.end.getMonth()).toBe(2);
    expect(fy.end.getDate()).toBe(31);
    expect(fy.label).toBe('FY 2025-26');
  });

  it('keeps Apr–Dec in the same calendar year', () => {
    const fy = getFiscalYear(new Date(2026, 8, 20));
    expect(fy.label).toBe('FY 2026-27');
  });
});

describe('resolvePreset', () => {
  const now = new Date(2026, 7, 15); // 15 Aug 2026

  it('computes month bounds', () => {
    expect(resolvePreset('this-month', now)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(resolvePreset('last-month', now)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('computes quarter bounds', () => {
    expect(resolvePreset('this-quarter', now)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePreset('last-quarter', now)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    // January rolls back into the previous year's Q4
    const jan = new Date(2026, 0, 5);
    expect(resolvePreset('last-quarter', jan)).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('computes fiscal-year bounds', () => {
    expect(resolvePreset('this-fy', now)).toEqual({ from: '2026-04-01', to: '2027-03-31' });
    expect(resolvePreset('last-fy', now)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });

  it('resolves this-fy across the March boundary correctly', () => {
    const feb = new Date(2026, 1, 28);
    expect(resolvePreset('this-fy', feb)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
  });
});

describe('summarizeAging', () => {
  it('sums every bucket column without recomputation', () => {
    const rows: AgingDocRow[] = [
      mkAging({ outstanding: 500, current: 200, days_1_30: 300 }),
      mkAging({ outstanding: 250, current: 0, days_90_plus: 250 }),
    ];
    expect(summarizeAging(rows)).toEqual({
      outstanding: 750,
      current: 200,
      days_1_30: 300,
      days_31_60: 0,
      days_61_90: 0,
      days_90_plus: 250,
    });
  });

  it('handles empty result sets', () => {
    expect(summarizeAging([]).outstanding).toBe(0);
  });
});

function mkAging(over: Partial<AgingDocRow>): AgingDocRow {
  return {
    party_id: 'p1',
    party_name: 'Party',
    doc_id: 'd1',
    doc_number: 'INV-1',
    doc_date: '2026-01-01',
    due_date: '2026-01-31',
    outstanding: 0,
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
    ...over,
  };
}

describe('unbound guards', () => {
  it('gst summary is BOUND to get_gst_summary (T53 contract relayed)', async () => {
    const meta = REPORT_REGISTRY.find((r) => r.id === 'gst-summary');
    expect(meta?.status).toBe('available');
    expect(meta?.binding).toBe('get_gst_summary');
    // binding reaches for the RPC; a missing/unreachable backend surfaces a
    // supabase error, NOT the stale not-ready guard
    await expect(
      fetchGstSummary({ businessId: 'b', range: { from: '2026-04-01', to: '2027-03-31' } })
    ).rejects.not.toBeInstanceOf(ReportNotReadyError);
  });

  it('carries the family id for UI messaging', () => {
    const err = new ReportNotReadyError('gst-summary');
    expect(err.familyId).toBe('gst-summary');
    expect(err.name).toBe('ReportNotReadyError');
  });

  it('profit-loss binding no longer throws statically (plumbing in place)', async () => {
    await expect(fetchProfitLoss({ businessId: 'x', range: { from: 'a', to: 'b' } })).rejects.not.toBeInstanceOf(
      ReportNotReadyError
    );
  });
});

describe('T109 production gap families', () => {
  const range = { from: '2026-04-01', to: '2027-03-31' };

  it('expense-report is registered against v_expense_summary with the honest no-payee note', () => {
    const meta = REPORT_REGISTRY.find((r) => r.id === 'expense-report');
    expect(meta?.status).toBe('available');
    expect(meta?.binding).toBe('v_expense_summary');
    expect(meta?.description).toMatch(/no party record/);
  });

  it('stock-report is registered against valuation + movements surfaces', () => {
    const meta = REPORT_REGISTRY.find((r) => r.id === 'stock-report');
    expect(meta?.status).toBe('available');
    expect(meta?.binding).toContain('get_stock_valuation');
    expect(meta?.binding).toContain('stock_movements');
  });

  it('expense plumbing reaches the view (never the stale not-ready guard)', async () => {
    await expect(
      fetchExpenseReport({ businessId: 'b', range, filters: { categoryName: 'Office' } })
    ).rejects.not.toBeInstanceOf(ReportNotReadyError);
  });

  it('stock plumbing reaches both surfaces (never the stale not-ready guard)', async () => {
    await expect(fetchStockReport({ businessId: 'b', range })).rejects.not.toBeInstanceOf(ReportNotReadyError);
  });
});
