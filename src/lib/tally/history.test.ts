import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabase } from '@/lib/supabase';
import {
  recordTallyExport,
  listTallyExports,
  upsertTallyLedgerMapping,
  deleteTallyLedgerMapping,
  listTallyLedgerMappings,
} from './history';
import { applyLedgerOverrides, validateBundle } from './generator';
import type { TallyExportBundle } from './types';

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;

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

describe('tally history rpc wrappers (057)', () => {
  it('recordTallyExport passes exact p_-named args incl array + metadata', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'hist-uuid-1', error: null });
    const id = await recordTallyExport({
      businessId: 'b1',
      dateFrom: '2026-04-01',
      dateTo: '2026-06-30',
      exportTypes: ['sales', 'opening_balances'],
      recordCount: 12,
      successCount: 12,
      warningCount: 2,
      errorCount: 0,
      status: 'completed',
      metadata: { format: 'xml' },
    });
    expect(id).toBe('hist-uuid-1');
    expect(rpcMock).toHaveBeenCalledWith('record_tally_export', {
      p_business_id: 'b1',
      p_date_from: '2026-04-01',
      p_date_to: '2026-06-30',
      p_export_types: ['sales', 'opening_balances'],
      p_record_count: 12,
      p_success_count: 12,
      p_warning_count: 2,
      p_error_count: 0,
      p_status: 'completed',
      p_metadata: { format: 'xml' },
    });
  });

  it('recordTallyExport surfaces server errors honestly', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'not a member' } });
    await expect(
      recordTallyExport({
        businessId: 'b1',
        dateFrom: '2026-04-01',
        dateTo: '2026-06-30',
        exportTypes: [],
        recordCount: 0,
        successCount: 0,
        warningCount: 0,
        errorCount: 0,
        status: 'completed',
      }),
    ).rejects.toThrow('not a member');
  });

  it('listTallyExports defaults limit and returns rows newest-first as given', async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ id: 'h1', status: 'completed' }], error: null });
    const rows = await listTallyExports('b1');
    expect(rpcMock).toHaveBeenCalledWith('list_tally_exports', { p_business_id: 'b1', p_limit: 100 });
    expect(rows[0].id).toBe('h1');
  });

  it('mapping CRUD passes trimmed args; parent omitted when null', async () => {
    rpcMock.mockResolvedValue({ data: 'map-uuid', error: null });
    await upsertTallyLedgerMapping('b1', 'Sales', 'Domestic Sales', null);
    let call = rpcMock.mock.calls[rpcMock.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(call).toEqual({
      p_business_id: 'b1',
      p_accountx_ledger: 'Sales',
      p_tally_ledger: 'Domestic Sales',
    });

    await upsertTallyLedgerMapping('b1', 'Sales', 'Domestic Sales', 'Sales Accounts');
    call = rpcMock.mock.calls[rpcMock.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(call.p_tally_parent).toBe('Sales Accounts');

    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await deleteTallyLedgerMapping('b1', 'Sales');
    expect(rpcMock).toHaveBeenLastCalledWith('delete_tally_ledger_mapping', {
      p_business_id: 'b1',
      p_accountx_ledger: 'Sales',
    });
  });

  it('listTallyLedgerMappings reads via RLS select', async () => {
    fromMock.mockReturnValue(
      thenable({
        data: [{ id: 'm1', accountx_ledger: 'Acme Traders', tally_ledger: 'ACME TRADERS', tally_parent: null }],
        error: null,
      }),
    );
    const rows = await listTallyLedgerMappings('b1');
    expect(fromMock).toHaveBeenCalledWith('tally_ledger_mappings');
    expect(rows[0].tally_ledger).toBe('ACME TRADERS');
  });
});

describe('applyLedgerOverrides (mapping doctrine)', () => {
  const bundle: TallyExportBundle = {
    companyName: 'C',
    ledgers: [
      { name: 'Acme Traders', parent: 'Sundry Debtors' },
      { name: 'Opening Balance Offset', parent: 'Reserves & Surplus' },
    ],
    vouchers: [
      {
        date: '2026-04-05',
        voucherType: 'Sales',
        voucherNumber: 'INV-1',
        partyLedgerName: 'Acme Traders',
        narration: 'n',
        entries: [
          { ledgerName: 'Acme Traders', isDebit: true, amount: 100 },
          { ledgerName: 'Sales', isDebit: false, amount: 100 },
        ],
      },
    ],
  };

  it('absent/empty overrides leave the bundle untouched (identity)', () => {
    expect(applyLedgerOverrides(bundle, [])).toBe(bundle);
    const same = applyLedgerOverrides(bundle, [{ accountx_ledger: 'Ghost', tally_ledger: 'X' }]);
    expect(same.ledgers[0].name).toBe('Acme Traders');
    expect(same.vouchers[0].entries[0].ledgerName).toBe('Acme Traders');
  });

  it('renames master AND all references; parent override applies too', () => {
    const out = applyLedgerOverrides(bundle, [
      { accountx_ledger: 'Acme Traders', tally_ledger: 'ACME TRADING CO', tally_parent: 'Debtors - Local' },
      { accountx_ledger: 'Opening Balance Offset', tally_ledger: 'Opening Balance Offset' },
    ]);
    expect(out.ledgers.find((l) => l.name === 'ACME TRADING CO')).toMatchObject({ parent: 'Debtors - Local' });
    expect(out.ledgers.find((l) => l.name === 'Acme Traders')).toBeUndefined();
    expect(out.vouchers[0].partyLedgerName).toBe('ACME TRADING CO');
    expect(out.vouchers[0].entries[0].ledgerName).toBe('ACME TRADING CO');
    // untouched canonical name passes through
    expect(out.vouchers[0].entries[1].ledgerName).toBe('Sales');
    // renamed bundle still validates clean
    expect(validateBundle(out.ledgers, out.vouchers).filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('many-to-one collisions are rejected outright - never silently merged', () => {
    const b: TallyExportBundle = {
      companyName: 'C',
      ledgers: [
        { name: 'A', parent: 'Sundry Debtors' },
        { name: 'B', parent: 'Sundry Debtors' },
      ],
      vouchers: [
        {
          date: '2026-04-05',
          voucherType: 'Journal',
          voucherNumber: 'J1',
          partyLedgerName: 'A',
          narration: '',
          entries: [
            { ledgerName: 'A', isDebit: true, amount: 50 },
            { ledgerName: 'B', isDebit: true, amount: 50 },
            { ledgerName: 'Cash', isDebit: false, amount: 100 },
          ],
        },
      ],
    };
    expect(() =>
      applyLedgerOverrides(b, [
        { accountx_ledger: 'A', tally_ledger: 'MERGED' },
        { accountx_ledger: 'B', tally_ledger: 'MERGED' },
      ]),
    ).toThrow(/mapping collision/);
  });
});
