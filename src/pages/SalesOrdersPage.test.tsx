// @vitest-environment jsdom
/**
 * PBS-178 / human dir#6 — document read-path audit witness.
 *
 * The support-mode complaint ("Support Mode shows 0 records") was adjudicated
 * DB-SIDE (RLS denies the impersonating super admin; fix = the queued
 * migration). The CODE side must hold a proven-negative contract instead:
 *
 * 1. the sales-orders list read is scoped EXACTLY like the human's own
 *    verification query: .eq('business_id', activeBusiness.id) + order desc
 *    + pagination range — and NEVER by a principal column (created_by /
 *    owner_id / user_id / auth.uid());
 * 2. the react-query cache is keyed by activeBusiness.id, so after an
 *    in-place business switch (the Header switcher) the page refetches with
 *    the NEW scope and can render at most a transient placeholder — never a
 *    settled cross-tenant view;
 * 3. support mode itself switches via reload (runImpersonation → hard
 *    navigate on missed re-resolution; SuperAdminPage comment "reloads the
 *    app, which re-initialises AuthContext from localStorage"), so no stale
 *    module cache survives the switch. The key-scope assertion below is what
 *    makes that reload guarantee observable for in-place switches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const eqCalls: Array<[string, string]> = [];
const orderCalls: string[] = [];
const rangeCalls: Array<[number, number]> = [];
let tableRows: any[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: any[]) => {
      void args;
      return {
        select: () => ({
          eq: (col: string, val: string) => {
            eqCalls.push([col, String(val)]);
            return {
              eq: (col: string, val: string) => {
                eqCalls.push([col, String(val)]);
                return chainTail();
              },
              or: ctorOr(),
              order: chainOrder(),
            };
          },
          or: ctorOr(),
          order: chainOrder(),
        }),
      };
    },
  },
}));

// Tail of the builder chain: .order(...) → .range(from, to) → resolved result.
const chainTail = () => ({
  eq: () => chainTail(),
  or: () => chainTail(),
  order: chainOrder(),
});
const chainOrder = () => (col: string, opts?: any) => {
  orderCalls.push(col);
  expect(opts).toEqual({ ascending: false });
  return {
    range: (from: number, to: number) => {
      rangeCalls.push([from, to]);
      return Promise.resolve({ data: tableRows, error: null, count: tableRows.length });
    },
  };
};
const ctorOr = () => (_clause: string) => chainTail();

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));

let activeBusinessOverride: any = {
  id: 'biz-1',
  name: 'Krishnav Agro Pvt Ltd',
};
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: activeBusinessOverride }),
}));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/usePagedList', () => ({
  usePagedList: () => ({
    search: '',
    setSearch: vi.fn(),
    debouncedSearch: '',
    page: 1,
    setPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    from: 0,
    to: 24,
  }),
  likePattern: (v: string) => `%${v.trim()}%`,
}));

import { SalesOrdersPage } from './SalesOrdersPage';

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const row = (id: string, orderNumber: string) => ({
  id,
  order_number: orderNumber,
  business_id: 'biz-1',
  status: 'confirmed',
  order_date: '2026-10-21',
  total: 1000,
  created_at: '2026-10-21T00:00:00.000Z',
  customer: { name: 'Verma Steel Works' },
});

beforeEach(() => {
  eqCalls.length = 0;
  orderCalls.length = 0;
  rangeCalls.length = 0;
  tableRows = [row('so-1', 'SO/26-27/1'), row('so-2', 'SO/26-27/2')];
  activeBusinessOverride = { id: 'biz-1', name: 'Krishnav Agro Pvt Ltd' };
});

afterEach(() => {
  cleanup();
});

describe('SalesOrdersPage — the read is business_id-scoped and never principal-scoped', () => {
  it('reads .from(sales_orders) with .eq(business_id, activeBusiness.id), ordered created_at desc + pagination range', async () => {
    wrap(<SalesOrdersPage />);
    await waitFor(() => expect(screen.getByText('SO/26-27/1')).toBeTruthy());
    expect(eqCalls).toEqual([['business_id', 'biz-1']]);
    expect(orderCalls).toEqual(['created_at']);
    expect(rangeCalls).toEqual([[0, 24]]);
    // The full builder state contains no principal filter anywhere.
    const recorded = eqCalls.map((c) => c[0]).join(',');
    expect(recorded).not.toContain('created_by');
    expect(recorded).not.toContain('owner_id');
    expect(recorded).not.toContain('user_id');
  });

  it('an in-place business switch re-fetches under the NEW business id (cache keyed by activeBusiness.id)', async () => {
    const { rerender } = wrap(<SalesOrdersPage />);
    await waitFor(() => expect(screen.getByText('SO/26-27/1')).toBeTruthy());
    expect(eqCalls).toEqual([['business_id', 'biz-1']]);

    activeBusinessOverride = { id: 'biz-2', name: 'Verma Steel Works' };
    tableRows = [{ ...row('so-9', 'SO/26-27/9'), business_id: 'biz-2' }];
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <SalesOrdersPage />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.getByText('SO/26-27/9')).toBeTruthy());
    expect(eqCalls).toEqual([
      ['business_id', 'biz-1'],
      ['business_id', 'biz-2'],
    ]);
  });
});
