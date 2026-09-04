import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from '@/lib/supabase';
import {
  fetchGstSummary,
  fetchReceivablesAging,
  fetchPayablesAging,
  fetchGstr1Sections,
  fetchGstr3bComputed,
  fetchGstValidationIssues,
  fetchGstReconciliation,
  fetchCashBankAccounts,
  fetchCashBankWindowMovement,
} from './client';

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

/** Thenable query-builder stand-in for supabase-js chains. */
function thenable(result: { data: unknown; error: unknown }) {
  const t: Record<string, (...args: unknown[]) => unknown> = {};
  const self = () => t;
  ['select', 'eq', 'in', 'gte', 'lte'].forEach((m) => {
    t[m] = self;
  });
  t.then = (res?: unknown, rej?: unknown) =>
    Promise.resolve(result).then(res as never, rej as never);
  return t as never;
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe('gst client wrappers', () => {
  it('fetchGstSummary passes period params and surfaces server errors', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ section: 'Summary', net_amount: -500 }], error: null });
    const rows = await fetchGstSummary('b1', '2026-04-01', '2026-06-30');
    expect(rpcMock).toHaveBeenCalledWith('get_gst_summary', {
      p_business_id: 'b1',
      p_from_date: '2026-04-01',
      p_to_date: '2026-06-30',
    });
    expect(rows[0].net_amount).toBe(-500);

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(fetchGstSummary('b1', '2026-04-01', '2026-06-30')).rejects.toThrow('denied');
  });

  it('aging wrappers include p_as_of only when provided', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await fetchReceivablesAging('b1');
    expect(rpcMock).toHaveBeenCalledWith('get_receivables_aging', { p_business_id: 'b1' });
    await fetchReceivablesAging('b1', '2026-03-31');
    expect(rpcMock).toHaveBeenLastCalledWith('get_receivables_aging', {
      p_business_id: 'b1',
      p_as_of: '2026-03-31',
    });
    await fetchPayablesAging('b2', '2026-03-31');
    expect(rpcMock).toHaveBeenLastCalledWith('get_payables_aging', {
      p_business_id: 'b2',
      p_as_of: '2026-03-31',
    });
  });

  it('cash/bank accounts select only Cash and Bank rows', async () => {
    fromMock.mockReturnValue(
      thenable({
        data: [
          { name: 'Cash', current_balance: 10 },
          { name: 'Bank', current_balance: 20 },
        ],
        error: null,
      }),
    );
    const rows = await fetchCashBankAccounts('b1');
    expect(fromMock).toHaveBeenCalledWith('accounts');
    expect(rows.map((r) => r.name)).toEqual(['Cash', 'Bank']);
  });

  it('window movement nets debit-credit per ledger over posted lines only', async () => {
    fromMock.mockReturnValue(
      thenable({
        data: [
          {
            lines: [
              { account_name: 'Bank', debit_amount: 1000, credit_amount: 0 },
              { account_name: 'Sales', debit_amount: 0, credit_amount: 1000 },
              { account_name: 'Rent', debit_amount: 300, credit_amount: 0 },
              { account_name: 'Cash', debit_amount: 0, credit_amount: 120.5 },
            ],
          },
          {
            lines: [{ account_name: 'Cash', debit_amount: 20, credit_amount: 0 }],
          },
        ],
        error: null,
      }),
    );
    const net = await fetchCashBankWindowMovement('b1', '2026-04-01', '2026-04-30');
    expect(net).toEqual({ Cash: -100.5, Bank: 1000 });
    expect(fromMock).toHaveBeenCalledWith('journal_entries');
  });
});

describe('gstr + validation + reconciliation wrappers', () => {
  it('fetchGstr1Sections passes period and returns the sectioned payload', async () => {
    const payload = {
      period: { from: '2026-04-01', to: '2026-06-30' },
      b2b: { rows: [], totals: { doc_count: 2, taxable_value: 1000 } },
      cdnr: { rows: [{ effect: 'decreases_output' }], totals: { credit_notes: 1, debit_notes: 0 } },
      zero_rated_note: undefined,
    };
    rpcMock.mockResolvedValueOnce({ data: payload, error: null });
    const res = await fetchGstr1Sections('b1', '2026-04-01', '2026-06-30');
    expect(rpcMock).toHaveBeenCalledWith('get_gstr1_sections', {
      p_business_id: 'b1',
      p_from: '2026-04-01',
      p_to: '2026-06-30',
    });
    expect(res.b2b.totals.doc_count).toBe(2);
    expect(res.cdnr.rows[0].effect).toBe('decreases_output');
  });

  it('fetchGstr3bComputed surfaces net position verbatim', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        basis: 'document-truth',
        zero_rated: { note: 'is_export columns not landed' },
        net_position: { cgst: 9, sgst: 9, igst: 0, cess: 0, total_net_payable: 18, is_credit_carried_forward: false },
      },
      error: null,
    });
    const res = await fetchGstr3bComputed('b1', '2026-04-01', '2026-06-30');
    expect(rpcMock).toHaveBeenLastCalledWith('get_gstr3b_computed', {
      p_business_id: 'b1',
      p_from: '2026-04-01',
      p_to: '2026-06-30',
    });
    expect(res.basis).toBe('document-truth');
    expect(res.net_position.total_net_payable).toBe(18);
    expect((res.zero_rated as { note?: string }).note).toContain('not landed');
  });

  it('fetchGstValidationIssues returns table rows; errors surface server message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          severity: 'critical',
          doc_type: 'sales_invoice',
          doc_id: 'd1',
          doc_number: 'INV-1',
          doc_date: '2026-04-05',
          party: 'Acme',
          problem: 'party gstin malformed',
          code: 'GSTIN_FORMAT',
          suggested_fix: 'correct the GSTIN',
        },
      ],
      error: null,
    });
    const rows = await fetchGstValidationIssues('b1', '2026-04-01', '2026-06-30');
    expect(rows[0].code).toBe('GSTIN_FORMAT');
    expect(rows[0].severity).toBe('critical');

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'no access' } });
    await expect(fetchGstValidationIssues('b1', '2026-04-01', '2026-06-30')).rejects.toThrow('no access');
  });

  it('fetchGstReconciliation returns rows + totals block', async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        rows: [{ doc_type: 'sales_invoice', doc_number: 'INV-1', match_status: 'difference', unmapped_residual: 0.02 }],
        totals: { absolute_difference_sum: 0.02 },
        notes_coverage: { covered: 3 },
      },
      error: null,
    });
    const res = await fetchGstReconciliation('b1', '2026-04-01', '2026-06-30');
    expect(rpcMock).toHaveBeenLastCalledWith('get_gst_reconciliation', {
      p_business_id: 'b1',
      p_from: '2026-04-01',
      p_to: '2026-06-30',
    });
    expect(res.rows[0].match_status).toBe('difference');
    expect(res.totals.absolute_difference_sum).toBe(0.02);
    expect(res.notes_coverage).toEqual({ covered: 3 });
  });
});
