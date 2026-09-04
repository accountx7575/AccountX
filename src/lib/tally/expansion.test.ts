import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateTallyXml, generateTallyCsv, escapeCsvField } from './generator';
import {
  mapCreditNoteToVoucher,
  mapDebitNoteToVoucher,
  mapJournalToVoucher,
  mapProductsToStockMasters,
  buildArOpeningVoucher,
  buildApOpeningVoucher,
  buildCashBankOpeningVoucher,
  openingOffsetMaster,
  deriveCashBankOpening,
  OPENING_OFFSET_ACCOUNT,
} from './mapping';
import { runPreflight } from './preflight';

const creditNote = {
  credit_note_number: 'CN-0001',
  date: '2026-04-10',
  status: 'issued',
  taxable_amount: 200,
  cgst_amount: 18,
  sgst_amount: 18,
  igst_amount: 0,
  cess_amount: 0,
  round_off: -0.1,
  grand_total: 235.9,
  reason: 'Damaged goods returned',
  customer: { name: 'Acme Traders' },
};

const debitNote = {
  debit_note_number: 'DN-0001',
  date: '2026-04-11',
  status: 'applied',
  taxable_amount: 100,
  cgst_amount: 9,
  sgst_amount: 9,
  igst_amount: 0,
  cess_amount: 0,
  round_off: 0.2,
  grand_total: 118.2,
  supplier: { name: 'Global Supplies' },
};

function signedSum(entries: { isDebit: boolean; amount: number }[]): number {
  return entries.reduce((a, e) => a + (e.isDebit ? -e.amount : e.amount), 0);
}

describe('credit note voucher', () => {
  it('mirrors the sales invoice: Dr sales + output GST, Cr customer', () => {
    const v = mapCreditNoteToVoucher(creditNote)!;
    expect(v.voucherType).toBe('Credit Note');
    expect(v.entries.find((e) => e.ledgerName === 'Sales')).toMatchObject({ isDebit: true, amount: 200 });
    expect(v.entries.find((e) => e.ledgerName === 'Output CGST')).toMatchObject({ isDebit: true, amount: 18 });
    expect(v.entries.find((e) => e.ledgerName === 'Acme Traders')).toMatchObject({ isDebit: false, amount: 235.9 });
    expect(v.entries.find((e) => e.ledgerName === 'Round Off')).toMatchObject({ isDebit: false, amount: 0.1 });
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
    expect(v.narration).toContain('CN-0001');
    expect(v.narration).toContain('Damaged goods returned');
  });

  it('positive round-off lands on the DEBIT side for credit notes', () => {
    const v = mapCreditNoteToVoucher({ ...creditNote, round_off: 0.5, grand_total: 236.5 })!;
    expect(v.entries.find((e) => e.ledgerName === 'Round Off')).toMatchObject({ isDebit: true, amount: 0.5 });
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
  });

  it('skips draft/cancelled notes and missing parties', () => {
    expect(mapCreditNoteToVoucher({ ...creditNote, status: 'draft' })).toBeNull();
    expect(mapCreditNoteToVoucher({ ...creditNote, status: 'cancelled' })).toBeNull();
    expect(mapCreditNoteToVoucher({ ...creditNote, customer: null })).toBeNull();
  });
});

describe('debit note voucher', () => {
  it('mirrors the purchase bill: Dr supplier, Cr purchases + input GST', () => {
    const v = mapDebitNoteToVoucher(debitNote)!;
    expect(v.voucherType).toBe('Debit Note');
    expect(v.entries.find((e) => e.ledgerName === 'Global Supplies')).toMatchObject({ isDebit: true, amount: 118.2 });
    expect(v.entries.find((e) => e.ledgerName === 'Purchases')).toMatchObject({ isDebit: false, amount: 100 });
    expect(v.entries.find((e) => e.ledgerName === 'Input CGST')).toMatchObject({ isDebit: false, amount: 9 });
    expect(v.entries.find((e) => e.ledgerName === 'Round Off')).toMatchObject({ isDebit: false, amount: 0.2 });
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
  });

  it('exports issued and applied but skips draft/cancelled', () => {
    expect(mapDebitNoteToVoucher({ ...debitNote, status: 'issued' })).not.toBeNull();
    expect(mapDebitNoteToVoucher({ ...debitNote, status: 'draft' })).toBeNull();
    expect(mapDebitNoteToVoucher({ ...debitNote, status: 'cancelled' })).toBeNull();
  });
});

describe('journal voucher', () => {
  it('maps real account_name/debit_amount/credit_amount columns', () => {
    const v = mapJournalToVoucher({
      entry_number: 'JE-0007',
      date: '2026-04-12',
      narration: 'Depreciation',
      lines: [
        { account_name: 'Depreciation', debit_amount: 500, credit_amount: 0 },
        { account_name: 'Furniture', debit_amount: 0, credit_amount: 500 },
        { account_name: 'Ignored Zero Line', debit_amount: 0, credit_amount: 0 },
      ],
    })!;
    expect(v.voucherType).toBe('Journal');
    expect(v.entries).toHaveLength(2);
    expect(v.entries[0]).toEqual({ ledgerName: 'Depreciation', isDebit: true, amount: 500 });
    expect(v.entries[1]).toEqual({ ledgerName: 'Furniture', isDebit: false, amount: 500 });
  });

  it('returns null for empty/all-zero line sets', () => {
    expect(mapJournalToVoucher({ entry_number: 'J', date: '2026-04-12', narration: null, lines: [] })).toBeNull();
  });
});

describe('stock item masters', () => {
  it('maps unit and hsn with honest fallbacks', () => {
    const items = mapProductsToStockMasters([
      { name: 'Widget', unit: 'Pcs', hsn_sac: '732690', description: ' steel widget ' },
      { name: 'Service Fee', unit: null, hsn_sac: null },
      { name: '   ', unit: 'Nos' },
    ]);
    expect(items).toEqual([
      { name: 'Widget', parent: 'Primary', baseUnit: 'Pcs', hsnSac: '732690', description: 'steel widget' },
      { name: 'Service Fee', parent: 'Primary', baseUnit: 'Nos', hsnSac: undefined, description: undefined },
    ]);
  });
});

describe('opening balance vouchers', () => {
  const asOf = '2026-03-31';

  it('builds consolidated AR opening with offset leg', () => {
    const v = buildArOpeningVoucher(
      [
        { partyName: 'Acme Traders', amount: 1000 },
        { partyName: 'Beta Corp', amount: 250.5 },
        { partyName: 'Advance Payer', amount: -100 },
      ],
      asOf,
    )!;
    expect(v.voucherNumber).toBe('OPEN-AR');
    expect(v.date).toBe(asOf);
    const acme = v.entries.find((e) => e.ledgerName === 'Acme Traders')!;
    expect(acme).toMatchObject({ isDebit: true, amount: 1000 });
    const adv = v.entries.find((e) => e.ledgerName === 'Advance Payer')!;
    expect(adv).toMatchObject({ isDebit: false, amount: 100 });
    const offset = v.entries.find((e) => e.ledgerName === OPENING_OFFSET_ACCOUNT)!;
    expect(offset.isDebit).toBe(false);
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
  });

  it('mirrors AP opening (Dr offset / Cr suppliers)', () => {
    const v = buildApOpeningVoucher([{ partyName: 'Global Supplies', amount: 700 }], asOf)!;
    expect(v.voucherNumber).toBe('OPEN-AP');
    expect(v.entries.find((e) => e.ledgerName === 'Global Supplies')).toMatchObject({ isDebit: false, amount: 700 });
    expect(v.entries.find((e) => e.ledgerName === OPENING_OFFSET_ACCOUNT)!.isDebit).toBe(true);
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
  });

  it('builds cash/bank opening with offset and skips zero balances', () => {
    const v = buildCashBankOpeningVoucher(
      [
        { ledgerName: 'Cash', opening: 5000 },
        { ledgerName: 'Bank', opening: -200 },
        { ledgerName: 'Empty', opening: 0 },
      ],
      asOf,
    )!;
    expect(v.voucherNumber).toBe('OPEN-CASHBANK');
    expect(v.entries.find((e) => e.ledgerName === 'Cash')).toMatchObject({ isDebit: true, amount: 5000 });
    expect(v.entries.find((e) => e.ledgerName === 'Bank')).toMatchObject({ isDebit: false, amount: 200 });
    expect(v.entries.find((e) => e.ledgerName === 'Empty')).toBeUndefined();
    expect(Math.abs(signedSum(v.entries))).toBeLessThan(0.001);
  });

  it('returns null when nothing to open; exposes offset master', () => {
    expect(buildArOpeningVoucher([], asOf)).toBeNull();
    expect(buildArOpeningVoucher([{ partyName: 'Zero', amount: 0 }], asOf)).toBeNull();
    expect(openingOffsetMaster()).toEqual({ name: OPENING_OFFSET_ACCOUNT, parent: 'Reserves & Surplus' });
  });

  it('derives cash opening from live balance minus window movement', () => {
    expect(deriveCashBankOpening(10000, 1500)).toBe(8500);
    expect(deriveCashBankOpening(10000.005, 0)).toBe(10000);
    expect(deriveCashBankOpening(500, -250)).toBe(750);
  });
});

describe('csv variant', () => {
  const bundle = {
    companyName: 'My Company',
    ledgers: [],
    vouchers: [
      {
        date: '2026-04-05',
        voucherType: 'Sales' as const,
        voucherNumber: 'INV-0001',
        partyLedgerName: 'A & B "Traders", LLP',
        narration: 'Multi\nline, narr;ation',
        entries: [
          { ledgerName: 'Acme, Inc.', isDebit: true, amount: 1179.8 },
          { ledgerName: 'Sales', isDebit: false, amount: 1179.8 },
        ],
      },
    ],
  };

  it('escapes quotes, commas and newlines per RFC4180', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('emits header, BOM and split debit/credit columns', () => {
    const csv = generateTallyCsv(bundle as never);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const body = csv.slice(1);
    const lines = body.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('Date,Voucher Type,Voucher Number,Party Ledger,Ledger,Debit,Credit,Narration');
    expect(lines[1]).toContain('"A & B ""Traders"", LLP"');
    expect(lines[1]).toMatch(/"Acme, Inc\.",1179\.80,0\.00/);
    expect(lines[2]).toMatch(/Sales,0\.00,1179\.80/);
    expect(lines[1]).toContain('"Multi\nline, narr;ation"');
  });
});

describe('xml well-formedness and sign convention', () => {
  function assertWellFormedXml(xml: string): void {
    const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
    const tokens = withoutComments.match(/<\/?[A-Za-z_][\w.]*(?:\s[^<>]*)?>/g) ?? [];
    const stack: string[] = [];
    for (const t of tokens) {
      const isClose = t.startsWith('</');
      const name = t.replace(/^<\/?/, '').replace(/\/?>$/, '').trim().split(/\s/)[0];
      if (t.endsWith('/>')) continue;
      if (isClose) {
        expect(stack.pop(), `closing ${name} but stack has ${stack.join(',')}`).toBe(name);
      } else {
        stack.push(name);
      }
    }
    expect(stack).toEqual([]);
  }

  it('produces balanced tags across a full enriched bundle', () => {
    const ledgers = [
      { name: 'Acme Traders', parent: 'Sundry Debtors', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' },
      openingOffsetMaster(),
    ];
    const vouchers = [
      mapCreditNoteToVoucher(creditNote)!,
      mapDebitNoteToVoucher(debitNote)!,
      buildArOpeningVoucher([{ partyName: 'Acme Traders', amount: 1000 }], '2026-03-31')!,
      mapJournalToVoucher({
        entry_number: 'JE-1',
        date: '2026-04-12',
        narration: null,
        lines: [
          { account_name: 'Cash', debit_amount: 100, credit_amount: 0 },
          { account_name: 'Sales', debit_amount: 0, credit_amount: 100 },
        ],
      })!,
    ];
    const xml = generateTallyXml({
      companyName: 'My Company <Ltd> & Sons',
      ledgers,
      vouchers,
      stockItems: mapProductsToStockMasters([{ name: 'Widget & Co', unit: 'Pcs', hsn_sac: '732690' }]),
      company: { name: 'My Company', legalName: 'Legal <Name>', address: '12/A Road', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' },
    });
    assertWellFormedXml(xml);
    expect(xml).toContain('<STOCKITEM NAME="Widget &amp; Co" Action="Create">');
    expect(xml).toContain('<BASEUNITS>Pcs</BASEUNITS>');
    expect(xml).toContain('<HSN>732690</HSN>');
    expect(xml).toContain('ACCOUNTX-COMPANY');
    expect(xml).toContain('<SVCURRENTCOMPANY>My Company &lt;Ltd&gt; &amp; Sons</SVCURRENTCOMPANY>');
  });

  it('pins the Tally rupee sign convention byte-exactly (debit negative)', () => {
    const v = mapCreditNoteToVoucher(creditNote)!;
    const xml = generateTallyXml({ companyName: 'C', ledgers: [], vouchers: [v] });
    const customerBlock = xml.slice(
      xml.indexOf('<LEDGERNAME>Acme Traders</LEDGERNAME>') - 200,
      xml.indexOf('<LEDGERNAME>Acme Traders</LEDGERNAME>') + 300,
    );
    expect(customerBlock).toContain('<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>');
    expect(customerBlock).toContain('<AMOUNT>235.90</AMOUNT>');
    const salesBlock = xml.slice(
      xml.indexOf('<LEDGERNAME>Sales</LEDGERNAME>') - 120,
      xml.indexOf('<LEDGERNAME>Sales</LEDGERNAME>') + 220,
    );
    expect(salesBlock).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
    expect(salesBlock).toContain('<AMOUNT>-200.00</AMOUNT>');
  });
});

describe('preflight', () => {
  it('aggregates doc-level issues before bundle build', () => {
    const issues = runPreflight({
      gstRegistered: true,
      invoices: [
        {
          invoice_number: 'INV-1',
          invoice_date: '2026-04-05',
          status: 'issued',
          taxable_amount: 1000,
          cgst_amount: 90,
          sgst_amount: 90,
          igst_amount: 0,
          cess_amount: 0,
          round_off: 0,
          grand_total: 1180,
          customer: { name: '', gstin: null },
        },
        {
          invoice_number: 'INV-2',
          invoice_date: 'bad-date',
          status: 'issued',
          taxable_amount: 100,
          cgst_amount: 18,
          sgst_amount: 0,
          igst_amount: 0,
          cess_amount: 0,
          round_off: 0,
          grand_total: 999,
          customer: { name: 'X' },
        },
      ],
      payments: [{ payment_number: 'PR-1', date: '2026-04-06', type: 'received', amount: 0, party_name: null }],
      notes: [
        {
          note_number: 'CN-9',
          note_date: '2026-04-07',
          status: 'issued',
          kind: 'credit',
          taxable_amount: -5,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: 0,
          cess_amount: 0,
          round_off: 0,
          grand_total: -5,
          party_name: 'Y',
        },
      ],
      stockItems: [{ name: 'NoMeta', baseUnit: '', hsnSac: '' }],
    });
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');
    expect(errors.some((e) => e.voucherNumber === 'Sales INV-1' && e.message.includes('missing customer ledger'))).toBe(true);
    expect(errors.some((e) => e.message.includes('unparsable date'))).toBe(true);
    expect(errors.some((e) => e.message.includes('do not add up to grand total'))).toBe(true);
    expect(errors.some((e) => e.message.includes('non-positive amount'))).toBe(true);
    expect(errors.some((e) => e.voucherNumber === 'Credit Note CN-9' && e.message.includes('negative tax'))).toBe(true);
    expect(errors[0].severity).toBe('error');
    expect(warnings.some((w) => w.message.includes('no GSTIN'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('no unit set'))).toBe(true);
    expect(warnings.some((w) => w.message.includes('no HSN/SAC'))).toBe(true);
  });

  it('ignores rows that mapping would skip anyway; flags duplicates once', () => {
    const issues = runPreflight({
      invoices: [
        { invoice_number: 'DUP-1', invoice_date: '2026-04-01', status: 'draft', taxable_amount: 1, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, cess_amount: 0, round_off: 0, grand_total: 1, customer: { name: 'A' } },
        { invoice_number: 'DUP-1', invoice_date: '2026-04-02', status: 'issued', taxable_amount: 1, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, cess_amount: 0, round_off: 0, grand_total: 1, customer: { name: 'A' } },
        { invoice_number: 'DUP-1', invoice_date: '2026-04-03', status: 'issued', taxable_amount: 1, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, cess_amount: 0, round_off: 0, grand_total: 1, customer: { name: 'A' } },
      ],
    });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(1);
  });
});
