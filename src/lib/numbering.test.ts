import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, string>[],
  taken: [] as string[],
  rpcResult: { data: null as unknown, error: null as unknown },
  orFilters: [] as string[],
  businessRow: null as Record<string, unknown> | null,
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      let candidate: string | null = null;
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          if (table !== 'businesses' && col !== 'business_id') candidate = val;
          return q;
        },
        or: (filter: string) => {
          h.orFilters.push(filter);
          return q;
        },
        limit: () => q,
        then: (resolve: any) =>
          resolve(
            table === 'businesses'
              ? { data: h.businessRow ? [h.businessRow] : [], error: null }
              : candidate === null
                ? { data: h.rows, error: null }
                : { data: h.taken.includes(candidate) ? [{}] : [], error: null }
          ),
      };
      return q;
    },
    rpc: () => Promise.resolve(h.rpcResult),
  },
}));

import { allocateDocumentNumber, swapPrefix } from './numbering';

const SO = { docType: 'sales_order' as const, table: 'sales_orders', numberColumn: 'order_number' };

describe('allocateDocumentNumber', () => {
  it('inherits the format family of the highest existing number', async () => {
    h.rows = [{ order_number: 'SO/26-27/1' }];
    h.taken = [];
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1' })).toBe('SO/26-27/2');
  });

  it('keeps padding style of the highest padded row', async () => {
    h.rows = [{ order_number: 'SO/26-27/1' }, { order_number: 'SO/2026/000007' }];
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1' })).toBe('SO/2026/000008');
  });

  it('probes forward around a racing insert until free', async () => {
    h.rows = [{ order_number: 'SO/2026/000007' }];
    h.taken = ['SO/2026/000008', 'SO/2026/000009'];
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1' })).toBe('SO/2026/000010');
  });

  it('fails with a descriptive error when every probe is taken', async () => {
    h.rows = [{ order_number: 'SO/26-27/1' }];
    h.taken = [];
    for (let i = 2; i < 27; i++) h.taken.push(`SO/26-27/${i}`);
    await expect(allocateDocumentNumber({ ...SO, businessId: 'b1' })).rejects.toThrow(
      /no free SO number within 25 probes/
    );
    h.taken = [];
  });

  it('falls back to the atomic counter RPC on an empty table', async () => {
    h.rows = [];
    h.rpcResult = { data: 'SO/2026/000001', error: null };
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1' })).toBe('SO/2026/000001');
  });

  it('propagates counter errors on an empty table', async () => {
    h.rpcResult = { data: null, error: { message: 'boom' } };
    await expect(allocateDocumentNumber({ ...SO, businessId: 'b1' })).rejects.toThrow('boom');
  });

  it('allocates under a custom configured prefix', async () => {
    h.rows = [{ order_number: 'EST/26-27/5' }];
    h.taken = [];
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1', prefix: 'EST' })).toBe('EST/26-27/6');
  });

  it('scans the rows of the configured prefix and escapes LIKE wildcards', async () => {
    h.rows = [];
    h.orFilters = [];
    h.rpcResult = { data: 'SO/2026/000001', error: null };
    await allocateDocumentNumber({ ...SO, businessId: 'b1', prefix: 'A_B' });
    expect(h.orFilters[0]).toBe('order_number.like.A\\_B/%,order_number.like.A\\_B-%');
  });

  it('swaps the counter prefix for the configured one when the table is empty', async () => {
    h.rows = [];
    h.rpcResult = { data: 'QT/2026/000001', error: null };
    expect(await allocateDocumentNumber({ ...SO, businessId: 'b1', prefix: 'EST' })).toBe('EST/2026/000001');
  });

  it('uses the prefix configured on the business row when the caller passes none', async () => {
    h.businessRow = { id: 'b1', quotation_prefix: 'EST' };
    h.rows = [{ quotation_number: 'EST/26-27/1' }];
    h.taken = [];
    expect(
      await allocateDocumentNumber({
        businessId: 'b1',
        docType: 'quotation',
        table: 'quotations',
        numberColumn: 'quotation_number',
      })
    ).toBe('EST/26-27/2');
    h.businessRow = null;
  });
});

describe('swapPrefix', () => {
  it('replaces the leading segment and keeps the rest of the number', () => {
    expect(swapPrefix('QT/26-27/12', 'EST')).toBe('EST/26-27/12');
    expect(swapPrefix('QT/2026/000001', 'QT')).toBe('QT/2026/000001');
  });

  it('adds the configured prefix to a bare number', () => {
    expect(swapPrefix('12', 'EST')).toBe('EST/12');
  });

  it('leaves an empty number alone', () => {
    expect(swapPrefix('', 'EST')).toBe('');
  });
});
