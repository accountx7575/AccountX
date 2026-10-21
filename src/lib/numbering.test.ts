import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Record<string, string>[],
  taken: [] as string[],
  rpcResult: { data: null as unknown, error: null as unknown },
}));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => {
      let candidate: string | null = null;
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          if (col !== 'business_id') candidate = val;
          return q;
        },
        or: () => q,
        limit: () => q,
        then: (resolve: any) =>
          resolve(
            candidate === null
              ? { data: h.rows, error: null }
              : { data: h.taken.includes(candidate) ? [{}] : [], error: null }
          ),
      };
      return q;
    },
    rpc: () => Promise.resolve(h.rpcResult),
  },
}));

import { allocateDocumentNumber } from './numbering';

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
});
