// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    starRow: null as Record<string, unknown> | null,
    selectCalls: [] as string[],
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: (sel: string) => {
        supabaseMock.selectCalls.push(sel);
        return {
          limit: () =>
            Promise.resolve(
              sel === '*' && supabaseMock.starRow
                ? { data: [supabaseMock.starRow], error: null }
                : { data: [], error: null },
            ),
        };
      },
    }),
  },
}));

const mockSupabase = (opts: { selectStarRow: Record<string, unknown> | null }) => {
  supabaseMock.starRow = opts.selectStarRow;
  supabaseMock.selectCalls.length = 0;
};

import {
  BUSINESS_KNOWN_MISSING_COLUMNS,
  BUSINESS_KNOWN_PRESENT_COLUMNS,
  clearCachedBusinessColumns,
  discoverBusinessColumns,
  filterPayloadByColumns,
  parseMissingColumnNames,
  planBusinessSave,
  trimPayloadValues,
} from './businessSchema';
import {
  flushBusinessColumnStash,
  readBusinessColumnStash,
  stashBusinessColumns,
} from './businessExtras';

describe('parseMissingColumnNames', () => {
  it('reads the 42703 unknown-column error', () => {
    const msg = 'column businesses.quotation_prefix does not exist';
    expect(parseMissingColumnNames(msg)).toContain('quotation_prefix');
  });

  it('reads the PGRST204 schema-cache error', () => {
    const msg =
      "Could not find the 'public' column 'pin_code' in the schema cache";
    expect(parseMissingColumnNames(msg)).toContain('pin_code');
  });

  it('returns an empty list for unrelated errors', () => {
    expect(parseMissingColumnNames('permission denied for table businesses')).toEqual([]);
    expect(parseMissingColumnNames(null)).toEqual([]);
    expect(parseMissingColumnNames(undefined)).toEqual([]);
  });
});

describe('filterPayloadByColumns', () => {
  it('keeps only columns that exist on the server', () => {
    const { send, missing } = filterPayloadByColumns(
      { name: 'Acme', quotation_prefix: 'QT', tnc_invoice: 'Terms' },
      BUSINESS_KNOWN_PRESENT_COLUMNS,
    );
    expect(send).toEqual({ name: 'Acme' });
    expect(missing).toEqual({ quotation_prefix: 'QT', tnc_invoice: 'Terms' });
  });

  it('matches columns case-insensitively', () => {
    const { send } = filterPayloadByColumns({ Name: 'Acme' }, ['name']);
    expect(send).toEqual({ Name: 'Acme' });
  });

  it('sends nothing when the server has none of the columns', () => {
    const { send, missing } = filterPayloadByColumns({ foo: 1 }, []);
    expect(send).toEqual({});
    expect(missing).toEqual({ foo: 1 });
  });
});

describe('trimPayloadValues', () => {
  it('trims strings only and leaves address punctuation intact', () => {
    const out = trimPayloadValues({
      name: '  Acme  ',
      address: '  12/3, Lane-4 #5  ',
      quota: 10,
      active: false,
      empty: null,
    });
    expect(out.name).toBe('Acme');
    expect(out.address).toBe('12/3, Lane-4 #5');
    expect(out.quota).toBe(10);
    expect(out.active).toBe(false);
    expect(out.empty).toBeNull();
  });
});

describe('discoverBusinessColumns', () => {
  beforeEach(() => {
    clearCachedBusinessColumns();
    localStorage.clear();
  });

  it('probes and drops the columns the server does not have', async () => {
    const attempted: string[][] = [];
    const probe = async (selectList: string[]) => {
      attempted.push(selectList);
      if (selectList.includes('quotation_prefix')) {
        return { message: 'column businesses.quotation_prefix does not exist' };
      }
      if (selectList.includes('tnc_invoice')) {
        return { message: "Could not find the 'public' column 'tnc_invoice' in the schema cache" };
      }
      return null;
    };
    const columns = await discoverBusinessColumns(probe);
    expect(columns).toContain('name');
    expect(columns).not.toContain('quotation_prefix');
    expect(columns).not.toContain('tnc_invoice');
    expect(attempted.length).toBeGreaterThan(1);
  });

  it('falls back to the verified seed when the probe cannot run', async () => {
    const probe = async () => ({ message: 'permission denied for table businesses' });
    const columns = await discoverBusinessColumns(probe);
    expect(columns).toEqual([...BUSINESS_KNOWN_PRESENT_COLUMNS]);
  });

  it('uses the fast `select("*")` probe when no custom probe is supplied', async () => {
    // The real `starProbe` selects '*'; pretend PostgREST returns one row with
    // only `name`. Present columns must include everything the app sends, so the
    // missing candidates are still dropped — plus the verified seed.
    mockSupabase({ selectStarRow: { name: 'Acme' } });
    const columns = await discoverBusinessColumns();
    expect(columns).toEqual(expect.arrayContaining(['name']));
    expect(columns).not.toContain('quotation_prefix');
    expect(columns).not.toContain('tnc_invoice');
  });

  it('caches the result so the probe runs once', async () => {
    const probe = vi.fn(async () => null);
    await discoverBusinessColumns(probe);
    const callsAfterFirst = probe.mock.calls.length;
    await discoverBusinessColumns(probe);
    expect(probe.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('planBusinessSave', () => {
  const opts = {
    prefixKeys: ['quotation_prefix', 'credit_note_prefix'],
    extrasKeys: ['pincode'],
    normalizePrefix: (v: string) => v.toUpperCase(),
  };

  it('sends existing columns and stashes the rest — one PATCH, no 400', () => {
    const plan = planBusinessSave(
      { name: 'Acme', pincode: '560001', quotation_prefix: 'qt', tnc_invoice: 'Terms' },
      ['name', 'pincode'],
      opts,
    );
    expect(plan.send).toEqual({ name: 'Acme', pincode: '560001' });
    expect(plan.missing).toEqual(['quotation_prefix', 'tnc_invoice']);
    expect(plan.missingValues).toEqual({ quotation_prefix: 'qt', tnc_invoice: 'Terms' });
    expect(plan.stashed.sort()).toEqual(['quotation_prefix', 'tnc_invoice']);
  });

  it('normalizes prefix values before stashing them', () => {
    const plan = planBusinessSave({ quotation_prefix: 'qt' }, ['name'], opts);
    expect(plan.prefixStash).toEqual({ quotation_prefix: 'QT' });
  });

  it('routes drifted extras to the legacy extras stash', () => {
    const plan = planBusinessSave({ pincode: '560001' }, ['name'], opts);
    expect(plan.extrasStash).toEqual({ pincode: '560001' });
    expect(plan.stashed).toEqual(['pincode']);
  });

  it('sends every column when the server has them all', () => {
    const plan = planBusinessSave(
      { name: 'Acme', pincode: '560001', quotation_prefix: 'QT' },
      ['name', 'pincode', 'quotation_prefix'],
      opts,
    );
    expect(plan.send).toEqual({ name: 'Acme', pincode: '560001', quotation_prefix: 'QT' });
    expect(plan.missing).toEqual([]);
    expect(plan.missingValues).toEqual({});
    expect(plan.stashed).toEqual([]);
  });

  it('keeps pincode / upi_qr_url / account_name — they exist server-side', () => {
    // Ground truth from the live-API probe: these three columns ARE present,
    // so the save must carry them (the PIN bug was stripping them).
    const payload = {
      name: 'Acme',
      pincode: '560001',
      upi_qr_url: 'https://upi.example/qr.png',
      account_name: 'Acme Traders',
      address: '12/3, Lane-4 #5, Indiranagar',
    };
    const plan = planBusinessSave(payload, [
      'name',
      'pincode',
      'upi_qr_url',
      'account_name',
      'address',
    ], opts);
    expect(plan.send).toEqual(payload);
    expect(plan.stashed).toEqual([]);
    expect(plan.missing).toEqual([]);
  });

  it('stashes (never sends) the six prefixes and the four tnc columns', () => {
    const missingNow = [
      'quotation_prefix',
      'sales_order_prefix',
      'purchase_order_prefix',
      'purchase_bill_prefix',
      'credit_note_prefix',
      'debit_note_prefix',
      'tnc_invoice',
      'tnc_quotation',
      'tnc_sales_order',
      'tnc_purchase',
    ];
    const payload: Record<string, unknown> = { name: 'Acme' };
    for (const k of missingNow) payload[k] = `value-${k}`;
    const plan = planBusinessSave(payload, ['name'], {
      prefixKeys: missingNow.filter((k) => k.endsWith('_prefix')),
      extrasKeys: [],
      normalizePrefix: (v: string) => v.toUpperCase(),
    });
    expect(plan.send).toEqual({ name: 'Acme' });
    for (const k of missingNow) {
      expect(plan.send).not.toHaveProperty(k);
      expect(plan.missing).toContain(k);
      expect(plan.missingValues).toHaveProperty(k);
    }
    expect(plan.stashed.sort()).toEqual([...missingNow].sort());
  });

  it('keeps special characters in the address untouched', () => {
    const address = ' 12/3, Lane-4 #5, Indiranagar ';
    const plan = planBusinessSave(
      { address: trimPayloadValues({ address }).address },
      ['address'],
      opts,
    );
    expect(plan.send.address).toBe('12/3, Lane-4 #5, Indiranagar');
  });
});

describe('business column stash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stashes values for columns the DB does not have yet', () => {
    stashBusinessColumns('biz-1', { quotation_prefix: 'QT', tnc_invoice: 'Terms' });
    expect(readBusinessColumnStash('biz-1')).toEqual({
      quotation_prefix: 'QT',
      tnc_invoice: 'Terms',
    });
  });

  it('flushes only the columns that now exist and keeps the rest', () => {
    stashBusinessColumns('biz-1', { quotation_prefix: 'QT', tnc_invoice: 'Terms' });
    const flushable = flushBusinessColumnStash('biz-1', ['name', 'quotation_prefix']);
    expect(flushable).toEqual({ quotation_prefix: 'QT' });
    expect(readBusinessColumnStash('biz-1')).toEqual({ tnc_invoice: 'Terms' });
  });

  it('empties the stash once every column exists', () => {
    stashBusinessColumns('biz-1', { quotation_prefix: 'QT' });
    const flushable = flushBusinessColumnStash('biz-1', ['name', 'quotation_prefix']);
    expect(flushable).toEqual({ quotation_prefix: 'QT' });
    expect(readBusinessColumnStash('biz-1')).toEqual({});
  });

  it('drops empty values instead of stashing them', () => {
    stashBusinessColumns('biz-1', { quotation_prefix: 'QT' });
    stashBusinessColumns('biz-1', { quotation_prefix: '' });
    expect(readBusinessColumnStash('biz-1')).toEqual({});
  });
});

describe('known column sets', () => {
  it('does not list the same column as both present and missing', () => {
    const present = new Set<string>(BUSINESS_KNOWN_PRESENT_COLUMNS);
    const overlap = BUSINESS_KNOWN_MISSING_COLUMNS.filter((c) => present.has(c));
    expect(overlap).toEqual([]);
  });
});
