import { describe, it, expect } from 'vitest';
import {
  buildCustomerUpdate,
  buildCustomerInsert,
  buildSupplierUpdate,
  buildSupplierInsert,
  buildJournalLines,
  buildAllocationRequest,
  buildNumberingParams,
  documentNumberMatches,
  computeDocLine,
  DOCUMENT_PREFIXES,
  type PartyForm,
} from '@/lib/payloads';
import { isBalanced } from '@/lib/accounting';

const fullForm = (over: Partial<PartyForm> = {}): PartyForm => ({
  name: 'Acme',
  company_name: 'Acme Pvt Ltd',
  phone: '9876543210',
  email: 'acme@example.com',
  gstin: '27ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  address: '1 Main St',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '411001',
  opening_balance: '5000',
  credit_limit: '100000',
  notes: 'vip',
  ...over,
});

describe('T8 balance-wipe regression — update payloads NEVER carry balance fields', () => {
  it('customer update payload omits opening_balance and current_balance', () => {
    const payload = buildCustomerUpdate(fullForm());
    expect(payload).not.toHaveProperty('opening_balance');
    expect(payload).not.toHaveProperty('current_balance');
    expect(payload).not.toHaveProperty('business_id');
  });

  it('supplier update payload omits balance fields', () => {
    const payload = buildSupplierUpdate(fullForm());
    expect(Object.keys(payload)).not.toContain('opening_balance');
    expect(Object.keys(payload)).not.toContain('current_balance');
  });

  it('balance fields cannot be smuggled in through extra form properties', () => {
    const hostile = fullForm({ opening_balance: '999999' }) as unknown as Record<string, unknown>;
    hostile.current_balance = 1; // extra key on the form object
    const payload = buildCustomerUpdate(hostile as unknown as PartyForm);
    expect(payload).not.toHaveProperty('current_balance');
    expect(payload).not.toHaveProperty('opening_balance');
  });

  it('editable non-balance field (credit_limit) survives customer updates', () => {
    expect(buildCustomerUpdate(fullForm())).toMatchObject({ credit_limit: 100000 });
  });

  it('insert payloads carry balances exactly once, seeded from opening', () => {
    const ci = buildCustomerInsert('biz-1', fullForm({ opening_balance: '1500.005' }));
    expect(ci).toMatchObject({ business_id: 'biz-1', opening_balance: 1500.01, current_balance: 1500.01 });
    const si = buildSupplierInsert('biz-1', fullForm({ opening_balance: '250' }));
    expect(si).toMatchObject({ opening_balance: 250, current_balance: 250 });
    expect(buildSupplierInsert('b', fullForm())).not.toHaveProperty('credit_limit');
  });
});

describe('JE payload builder — Dr == Cr identity on shaped lines', () => {
  it('normalizes string inputs into rounded numeric lines', () => {
    const lines = buildJournalLines([
      { account_id: 'a', debit: '100.005', credit: '' },
      { account_id: 'b', debit: '', credit: '100' },
      { account_id: 'c', debit: 'x', credit: '' }, // garbage parses to 0
    ]);
    expect(lines).toEqual([
      { account_id: 'a', debit_amount: 100.01, credit_amount: 0 },
      { account_id: 'b', debit_amount: 0, credit_amount: 100 },
      { account_id: 'c', debit_amount: 0, credit_amount: 0 },
    ]);
  });

  it('balanced samples pass isBalanced after shaping (incl. paise rounding)', () => {
    const balanced = buildJournalLines([
      { account_id: 'a', debit: '33.335', credit: '' },
      { account_id: 'b', debit: '', credit: '33.34' },
    ]);
    expect(isBalanced(balanced)).toBe(true);
  });

  it('unbalanced samples are caught by validate-side invariant', () => {
    const unbalanced = buildJournalLines([
      { account_id: 'a', debit: '100', credit: '' },
      { account_id: 'b', debit: '', credit: '90' },
    ]);
    expect(isBalanced(unbalanced)).toBe(false);
  });
});

describe('allocation request builder — caps enforced pre-send', () => {
  it('accepts a payment within outstanding balance', () => {
    expect(
      buildAllocationRequest('sales_invoice', 'inv-1', 750.005, 1000)
    ).toEqual({ referenceType: 'sales_invoice', referenceId: 'inv-1', amount: 750.01 });
  });

  it('accepts exact-payoff at the boundary', () => {
    expect(() => buildAllocationRequest('purchase_bill', 'bill-1', 500, 500)).not.toThrow();
  });

  it('rejects over-allocation before any network call', () => {
    expect(() => buildAllocationRequest('sales_invoice', 'inv-1', 1000.01, 1000)).toThrow(/exceeds/);
  });

  it('rejects zero/negative payments', () => {
    expect(() => buildAllocationRequest('sales_invoice', 'inv-1', 0, 100)).toThrow(/positive/);
    expect(() => buildAllocationRequest('sales_invoice', 'inv-1', -5, 100)).toThrow(/positive/);
  });
});

describe('numbering contract shape — PREFIX/YYYY/NNNNNN', () => {
  it('builds rpc params verbatim', () => {
    expect(buildNumberingParams('biz-9', 'quotation', '2026-04-01')).toEqual({
      p_business_id: 'biz-9',
      p_doc_type: 'quotation',
      p_date: '2026-04-01',
    });
  });

  it('every doc-type prefix matches the canonical result format', () => {
    for (const [, prefix] of Object.entries(DOCUMENT_PREFIXES)) {
      expect(documentNumberMatches(`${prefix}/2026/000042`, prefix)).toBe(true);
      expect(documentNumberMatches(`${prefix}/26/42`, prefix)).toBe(false);
      expect(documentNumberMatches(`${prefix}/2026/42`, prefix)).toBe(false);
    }
    expect(documentNumberMatches('INV/2026/000001', 'QT')).toBe(false);
  });
});

describe('T113 computeDocLine — invoice/bill line math invariants', () => {
  const paisa = (x: number) => Math.round(x * 100);

  it('computes gross, taxable and line total for a plain intra-state line', () => {
    expect(
      computeDocLine({ quantity: 2, rate: 500, discount_amount: 100, tax_rate: 18, isInterState: false })
    ).toEqual({
      gross_amount: 1000,
      taxable_amount: 900,
      cgst_amount: 81,
      sgst_amount: 81,
      igst_amount: 0,
      total_amount: 1062,
    });
  });

  it('clamps taxable at zero when discount exceeds line gross (over-discount)', () => {
    const line = computeDocLine({ quantity: 1, rate: 100, discount_amount: 250, tax_rate: 18, isInterState: false });
    expect(line.taxable_amount).toBe(0);
    expect(line.cgst_amount).toBe(0);
    expect(line.sgst_amount).toBe(0);
    expect(line.total_amount).toBe(0);
  });

  it('header totals equal sum of line totals even with an over-discounted row (T2 regression class)', () => {
    const lines = [
      computeDocLine({ quantity: 3, rate: 200, discount_amount: 0, tax_rate: 12, isInterState: false }),
      computeDocLine({ quantity: 1, rate: 100, discount_amount: 400, tax_rate: 18, isInterState: false }),
      computeDocLine({ quantity: 2, rate: 50.5, discount_amount: 10, tax_rate: 5, isInterState: false }),
    ];
    const sumTaxable = lines.reduce((a, l) => a + l.taxable_amount, 0);
    const sumTotal = lines.reduce((a, l) => a + l.total_amount, 0);
    // header derivation used by both create pages
    const totalTax = lines.reduce((a, l) => a + l.cgst_amount + l.sgst_amount + l.igst_amount, 0);
    expect(Math.round((sumTaxable + totalTax) * 100) / 100).toBeCloseTo(sumTotal, 2);
    expect(sumTaxable).toBeGreaterThanOrEqual(0); // clamp: negative leakage impossible
  });

  it('intra-state split follows residual rule: CGST+SGST re-sums exactly to line tax (odd paise)', () => {
    // taxable 1.00 @ 3% -> tax 0.03; symmetric halves could drift to 0.02+0.02
    const odd = computeDocLine({ quantity: 1, rate: 1, discount_amount: 0, tax_rate: 3, isInterState: false });
    expect(Math.round(odd.cgst_amount * 100) + Math.round(odd.sgst_amount * 100)).toBe(3);
    expect(paisa(odd.taxable_amount + odd.cgst_amount + odd.sgst_amount)).toBe(paisa(odd.total_amount));
    // clean even split stays symmetric
    const even = computeDocLine({ quantity: 2, rate: 500, discount_amount: 0, tax_rate: 18, isInterState: false });
    expect(even.cgst_amount).toBe(even.sgst_amount);
    expect(paisa(even.taxable_amount + even.cgst_amount + even.sgst_amount)).toBe(paisa(even.total_amount));
  });

  it('inter-state routes everything to IGST', () => {
    const line = computeDocLine({ quantity: 1, rate: 999, discount_amount: 0, tax_rate: 28, isInterState: true });
    expect(line.igst_amount).toBeCloseTo(279.72, 2);
    expect(line.cgst_amount).toBe(0);
    expect(line.sgst_amount).toBe(0);
    expect(line.total_amount).toBe(1278.72);
  });

  it('zero-value lines stay zero and never produce negative totals', () => {
    const line = computeDocLine({ quantity: 5, rate: 0, discount_amount: 0, tax_rate: 18, isInterState: false });
    expect(line.gross_amount).toBe(0);
    expect(line.total_amount).toBe(0);
  });
});
