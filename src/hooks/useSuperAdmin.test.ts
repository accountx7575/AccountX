// @vitest-environment jsdom
/**
 * PBS-176 / human dir#5: the super-admin console's tenant list must be
 * LIVE-FETCH-ONLY — every row on screen is a fetched network row, and a
 * failed fetch renders an EMPTY list. No mock array, no localStorage or
 * persistent cache, no invented tenants anywhere in the load path.
 *
 * (a)-(c) of god's recon were independently re-verified before writing:
 * - the only "asdf" in the tree is the guard's refusal pattern + doc comment;
 * - tenant state is plain useState filled by loadRealData()/fetchTenants();
 *   the strings in the mapping are per-field display defaults for FETCHED
 *   rows' null columns, not standalone rows;
 * - the only localStorage traffic in the console is the impersonation
 *   key switch (applyImpersonationKeys) and its clear() on exit — no
 *   tenant cache to invalidate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (...args: any[]) => fromMock(...args),
  },
}));

import { useSuperAdmin } from './useSuperAdmin';

const fetchedRow = (id: string, legalName: string) => ({
  id,
  legal_name: legalName,
  trade_name: null,
  gstin: '09ABCDE1234F1Z5',
  created_at: '2026-09-01T00:00:00.000Z',
  is_active: true,
  owner_id: 'u1',
  email: 'owner@example.com',
});

const businessesChain = (result: { data: unknown; error: unknown }) => ({
  select: (cols: string) => ({
    order: (_col: string, _opts: unknown) => {
      expect(cols).toBe('*');
      return Promise.resolve(result);
    },
  }),
});

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSuperAdmin.fetchTenants — live fetch only, nothing invented', () => {
  it('loads tenants over the network (RPC first) and renders exactly the fetched rows', async () => {
    rpcMock.mockResolvedValue({
      data: [fetchedRow('b1', 'Krishnav Agro Pvt Ltd'), fetchedRow('b2', 'Verma Steel Works')],
      error: null,
    });
    const { result } = renderHook(() => useSuperAdmin());
    const tenants = await result.current.fetchTenants();

    expect(rpcMock).toHaveBeenCalledWith('get_all_businesses_admin');
    expect(tenants.map((t) => t.id)).toEqual(['b1', 'b2']);
    expect(tenants.map((t) => t.legal_name)).toEqual([
      'Krishnav Agro Pvt Ltd',
      'Verma Steel Works',
    ]);
    // No invented/artefact row hides in the render path.
    expect(tenants.some((t) => /asdf/i.test(t.legal_name || ''))).toBe(false);
    // The RPC answered: the direct-table fallback never ran.
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('falls back ONLY to the direct live table read when the RPC 400s', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc 404' } });
    fromMock.mockReturnValue(businessesChain({
      data: [fetchedRow('b3', 'Sharma Traders')],
      error: null,
    }));
    const { result } = renderHook(() => useSuperAdmin());
    const tenants = await result.current.fetchTenants();

    expect(fromMock).toHaveBeenCalledWith('businesses');
    expect(tenants).toHaveLength(1);
    expect(tenants[0].legal_name).toBe('Sharma Traders');
  });

  it('maps display defaults only onto null columns of FETCHED rows', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc unavailable' } });
    fromMock.mockReturnValue(businessesChain({
      data: [{
        id: 'b4',
        legal_name: null,
        name: null,
        trade_name: null,
        gstin: null,
        created_at: '2026-09-02T00:00:00.000Z',
        is_active: null,
        owner_id: 'u2',
        email: null,
      }],
      error: null,
    }));
    const { result } = renderHook(() => useSuperAdmin());
    const [t] = await result.current.fetchTenants();

    expect(t.legal_name).toBe('Unnamed Business'); // per-field default, not a sandbox row
    expect(t.is_active).toBe(true);
    expect(t.owner_email).toBe('Registered Tenant');
  });

  it('a double failure renders an EMPTY list — no mock, seeded or cached fallback exists', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc down' } });
    fromMock.mockReturnValue(businessesChain({ data: null, error: { message: 'table down' } }));
    const { result } = renderHook(() => useSuperAdmin());
    const tenants = await result.current.fetchTenants();

    expect(tenants).toEqual([]);
    await waitFor(() => expect(result.current.error).toBe('table down'));
    // The two names that could EVER be mistaken for a baked-in fallback are
    // proven absent from the failure path.
    expect(tenants.map((t) => t.legal_name)).not.toContain('Avadh Boring Company');
    expect(tenants.map((t) => t.legal_name)).not.toContain('Unnamed Business');
  });

  it('the tenant load path performs zero localStorage/sessionStorage traffic', async () => {
    const storageOps: string[] = [];
    type AnyFn = (...args: any[]) => any;
    const track = (marker: string, orig: AnyFn): AnyFn =>
      ((...args: any[]): any => { storageOps.push(`${marker}:${String(args[0])}`); return orig(...args); });
    for (const store of [window.localStorage, window.sessionStorage]) {
      (store as any).getItem = track('get', store.getItem.bind(store));
      (store as any).setItem = track('set', store.setItem.bind(store));
      (store as any).removeItem = track('remove', store.removeItem.bind(store));
      (store as any).clear = track('clear', store.clear.bind(store));
    }

    rpcMock.mockResolvedValue({ data: [fetchedRow('b1', 'Krishnav Agro Pvt Ltd')], error: null });
    const { result } = renderHook(() => useSuperAdmin());
    await result.current.fetchTenants();

    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc down' } });
    fromMock.mockReturnValue(businessesChain({ data: null, error: { message: 'down' } }));
    await result.current.fetchTenants();

    expect(storageOps).toEqual([]);
  });
});
