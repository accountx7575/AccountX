import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rows: {} as Record<string, Record<string, unknown>[]>,
  updates: [] as { table: string; payload: Record<string, unknown>; eqs: [string, string][] }[],
  taken: false,
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      let selectList = '';
      let statuses: string[] | null = null;
      const eqs: [string, string][] = [];
      const q: any = {
        select: (list?: string) => {
          selectList = list || '';
          return q;
        },
        eq: (col: string, val: string) => {
          eqs.push([col, val]);
          return q;
        },
        neq: () => q,
        in: (_col: string, vals: string[]) => {
          statuses = vals;
          return q;
        },
        limit: () => q,
        order: () => q,
        single: () =>
          Promise.resolve({ data: table === 'businesses' ? h.settings : null, error: null }),
        update: (next: Record<string, unknown>) => {
          payload = next;
          return q;
        },
        then: (resolve: any) => {
          if (payload) {
            h.updates.push({ table, payload, eqs: [...eqs] });
            resolve({ data: null, error: null });
            return;
          }
          if (table !== 'businesses' && selectList === 'id') {
            resolve({ data: h.taken ? [{ id: 'other' }] : [], error: null });
            return;
          }
          if (table === 'businesses') {
            resolve({ data: h.settings ? [h.settings] : [], error: null });
            return;
          }
          let rows = h.rows[table] ?? [];
          if (statuses) rows = rows.filter((row) => statuses!.includes(String(row.status)));
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  },
}));

import { syncDraftDocumentNumbersInDb } from './numberingSync';

const settings = {
  id: 'b1',
  invoice_prefix: 'INV/ABC/SE',
  quotation_prefix: 'QT/ABC/SE',
  sales_order_prefix: 'SO/ABC/SE',
  purchase_order_prefix: 'PO/ABC/SE',
  financial_year: '2026-27',
};

describe('syncDraftDocumentNumbersInDb (Settings save)', () => {
  beforeEach(() => {
    h.settings = settings;
    h.updates = [];
    h.taken = false;
    h.rows = {
      quotations: [
        { id: 'q1', quotation_number: 'QT/26-27/2', status: 'draft' },
        { id: 'q2', quotation_number: 'QT/26-27/3', status: 'sent' },
        { id: 'q3', quotation_number: 'QT/26-27/4', status: 'accepted' },
      ],
      sales_orders: [
        { id: 'so1', order_number: 'SO/26-27/1', status: 'draft' },
        { id: 'so2', order_number: 'SO/26-27/2', status: 'confirmed' },
      ],
      sales_invoices: [{ id: 'inv1', invoice_number: 'INV/26-27/5', status: 'draft' }],
      purchase_orders: [{ id: 'po1', po_number: 'PO/26-27/6', status: 'draft' }],
    };
  });

  it('renumbers every draft/sent document with its configured prefix', async () => {
    const result = await syncDraftDocumentNumbersInDb({
      businessId: 'b1',
      businessSettings: { financial_year: '2026-27' },
    });

    expect(result.updated).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.byType).toEqual({
      quotation: 2,
      sales_order: 1,
      sales_invoice: 1,
      purchase_order: 1,
    });

    expect(h.updates).toEqual([
      { table: 'quotations', payload: { quotation_number: 'QT/ABC/SE/26-27/2' }, eqs: [['id', 'q1'], ['business_id', 'b1']] },
      { table: 'quotations', payload: { quotation_number: 'QT/ABC/SE/26-27/3' }, eqs: [['id', 'q2'], ['business_id', 'b1']] },
      { table: 'sales_orders', payload: { order_number: 'SO/ABC/SE/26-27/1' }, eqs: [['id', 'so1'], ['business_id', 'b1']] },
      { table: 'sales_invoices', payload: { invoice_number: 'INV/ABC/SE/26-27/5' }, eqs: [['id', 'inv1'], ['business_id', 'b1']] },
      { table: 'purchase_orders', payload: { po_number: 'PO/ABC/SE/26-27/6' }, eqs: [['id', 'po1'], ['business_id', 'b1']] },
    ]);
    expect(h.updates.map((u) => u.table)).not.toContain('purchase_bills');
  });

  it('leaves confirmed/accepted documents untouched', async () => {
    await syncDraftDocumentNumbersInDb({ businessId: 'b1' });
    const ids = h.updates.map((u) => u.eqs.find(([col]) => col === 'id')?.[1]);
    expect(ids.sort()).toEqual(['inv1', 'po1', 'q1', 'q2', 'so1']);
    expect(ids).not.toContain('q3');
    expect(ids).not.toContain('so2');
  });

  it('does not write numbers that already match the configured prefix', async () => {
    h.rows = {
      quotations: [{ id: 'q1', quotation_number: 'QT/ABC/SE/26-27/2', status: 'draft' }],
      sales_orders: [],
      sales_invoices: [],
      purchase_orders: [],
    };
    const result = await syncDraftDocumentNumbersInDb({ businessId: 'b1' });

    expect(result).toMatchObject({ updated: 0, unchanged: 1, failed: 0 });
    expect(h.updates).toHaveLength(0);
  });

  it('skips a row whose synced number is already used by another document', async () => {
    h.taken = true;
    const result = await syncDraftDocumentNumbersInDb({ businessId: 'b1' });

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(5);
    expect(h.updates).toHaveLength(0);
  });
});
