import { describe, it, expect } from 'vitest';
import type { Gstr1OutwardRow } from './gstApi';
import type { Gstr1Row } from '@/lib/reportsAdapter';
import { summarizeGstr1Rates } from './gstExport';

/**
 * Shape pin (god ruling, tcfix-s5): v_gstr1_outward (041) INNER JOINs
 * customers (name NOT NULL), so Gstr1OutwardRow.party_name is string - and
 * outward rows must stay assignable to the canonical reportsAdapter Gstr1Row
 * without casts. If either shape drifts apart again, this file fails to
 * compile under `npm run typecheck`.
 */
type AssertAssignable<T extends U, U> = true;
type _outwardRowsAreCanonicalRows = AssertAssignable<Gstr1OutwardRow, Gstr1Row>;

const row: Gstr1OutwardRow = {
  invoice_id: 'inv-1',
  doc_number: 'INV-0001',
  doc_date: '2026-04-05',
  party_name: 'Acme Traders',
  party_gstin: '27ABCDE1234F1Z5',
  section: 'B2B',
  place_of_supply: 'Maharashtra',
  tax_rate: 18,
  item_count: 2,
  taxable_value: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  cess: 0,
  total_tax: 180,
};

describe('GSTR-1 shape reconciliation pins', () => {
  it('outward rows flow into canonical helpers with no cast and party_name is trusted non-null', () => {
    const summaries = summarizeGstr1Rates([row]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ section: 'B2B', tax_rate: 18, docs: 1, taxable_value: 1000 });
    expect(row.party_name.length).toBeGreaterThan(0);
  });
});
