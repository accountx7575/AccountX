import { describe, it, expect } from 'vitest';
import { generateTallyXml, validateBundle, tallyDate } from './generator';
import {
  mapInvoiceToVoucher,
  mapBillToVoucher,
  mapPaymentToVoucher,
  mapPartiesToMasters,
} from './mapping';
import type { TallyExportBundle } from './types';

const inv = {
  invoice_number: 'INV-0001',
  invoice_date: '2026-04-05',
  status: 'issued',
  taxable_amount: 1000,
  cgst_amount: 90,
  sgst_amount: 90,
  igst_amount: 0,
  cess_amount: 0,
  round_off: -0.2,
  grand_total: 1179.8,
  customer: { name: 'Acme Traders' },
};

const bill = {
  bill_number: 'BILL-0001',
  bill_date: '2026-04-06',
  status: 'confirmed',
  taxable_amount: 500,
  cgst_amount: 45,
  sgst_amount: 45,
  igst_amount: 0,
  cess_amount: 0,
  round_off: 0,
  grand_total: 590,
  supplier: { name: 'Global Supplies' },
};

const payReceived = {
  payment_number: 'PR-0001',
  date: '2026-04-07',
  type: 'received',
  payment_method: 'bank',
  amount: 1179.8,
  party_name: 'Acme Traders',
};

const payMade = {
  payment_number: 'PM-0001',
  date: '2026-04-08',
  type: 'made',
  payment_method: 'cash',
  amount: 590,
  party_name: 'Global Supplies',
};

function buildBundle(): TallyExportBundle {
  const vouchers = [
    mapInvoiceToVoucher(inv)!,
    mapBillToVoucher(bill)!,
    mapPaymentToVoucher(payReceived)!,
    mapPaymentToVoucher(payMade)!,
  ].filter(Boolean);
  const ledgers = mapPartiesToMasters(
    [{ name: 'Acme Traders', gstin: '27ABCDE1234F1Z5', state: 'Maharashtra' }],
    [{ name: 'Global Supplies', state: 'Gujarat' }],
  );
  return { companyName: 'My Company', ledgers, vouchers };
}

describe('tally mapping', () => {
  it('skips draft and cancelled invoices', () => {
    expect(mapInvoiceToVoucher({ ...inv, status: 'draft' })).toBeNull();
    expect(mapInvoiceToVoucher({ ...inv, status: 'cancelled' })).toBeNull();
    expect(mapInvoiceToVoucher({ ...inv, customer: null })).toBeNull();
  });

  it('sales voucher debits party and credits sales + GST + round-off', () => {
    const v = mapInvoiceToVoucher(inv)!;
    expect(v.voucherType).toBe('Sales');
    expect(v.entries[0]).toEqual({ ledgerName: 'Acme Traders', isDebit: true, amount: 1179.8 });
    const names = v.entries.map((e) => e.ledgerName);
    expect(names).toContain('Sales');
    expect(names).toContain('Output CGST');
    expect(names).toContain('Output SGST');
    expect(names).not.toContain('Output IGST');
    // negative round-off becomes a debit
    expect(v.entries.find((e) => e.ledgerName === 'Round Off')?.isDebit).toBe(true);
    const signed = v.entries.reduce((a, e) => a + (e.isDebit ? -e.amount : e.amount), 0);
    expect(Math.abs(signed)).toBeLessThan(0.001);
  });

  it('purchase voucher credits party and debits purchases + input GST', () => {
    const v = mapBillToVoucher(bill)!;
    expect(v.entries.find((e) => e.ledgerName === 'Purchases')?.isDebit).toBe(true);
    expect(v.entries.find((e) => e.ledgerName === 'Input CGST')?.isDebit).toBe(true);
    expect(v.entries.find((e) => e.ledgerName === 'Global Supplies')?.isDebit).toBe(false);
    const signed = v.entries.reduce((a, e) => a + (e.isDebit ? -e.amount : e.amount), 0);
    expect(Math.abs(signed)).toBeLessThan(0.001);
  });

  it('payments map to Receipt/Payment with cash/bank ledger by method', () => {
    const r = mapPaymentToVoucher(payReceived)!;
    expect(r.voucherType).toBe('Receipt');
    expect(r.entries.map((e) => e.ledgerName)).toEqual(['Bank', 'Acme Traders']);
    const m = mapPaymentToVoucher(payMade)!;
    expect(m.voucherType).toBe('Payment');
    expect(m.entries.map((e) => e.ledgerName)).toEqual(['Global Supplies', 'Cash']);
  });

  it('party masters use Sundry Debtors/Creditors groups', () => {
    const masters = mapPartiesToMasters(
      [{ name: 'Acme Traders' }],
      [{ name: 'Global Supplies' }],
    );
    expect(masters).toEqual([
      { name: 'Acme Traders', parent: 'Sundry Debtors', address: undefined, gstin: undefined, state: undefined, pincode: undefined },
      { name: 'Global Supplies', parent: 'Sundry Creditors', address: undefined, gstin: undefined, state: undefined, pincode: undefined },
    ]);
  });
});

describe('tally generator', () => {
  it('emits import envelope with masters and vouchers', () => {
    const xml = generateTallyXml(buildBundle());
    expect(xml).toContain('<ENVELOPE>');
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(xml).toContain('<SVCURRENTCOMPANY>My Company</SVCURRENTCOMPANY>');
    expect(xml).toContain('<LEDGER NAME="Acme Traders" Action="Create">');
    expect(xml).toContain('<PARENT>Sundry Debtors</PARENT>');
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
    expect(xml).toContain('<VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>');
    expect(xml).toMatch(/<DATE>20260405<\/DATE>/);
    expect(xml).not.toContain('&nbsp;');
  });

  it('encodes debit as ISDEEMEDPOSITIVE Yes with negative amount', () => {
    const xml = generateTallyXml(buildBundle());
    const partyBlock = xml.slice(xml.indexOf('<LEDGERNAME>Acme Traders</LEDGERNAME>') - 200, xml.indexOf('<LEDGERNAME>Acme Traders</LEDGERNAME>') + 300);
    expect(partyBlock).toContain('<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>');
    expect(partyBlock).toContain('<AMOUNT>-1179.80</AMOUNT>');
  });

  it('escapes XML-sensitive ledger names', () => {
    const bundle = buildBundle();
    bundle.ledgers[0].name = 'A & B <Traders>';
    const xml = generateTallyXml(bundle);
    expect(xml).toContain('A &amp; B &lt;Traders&gt;');
  });

  it('converts dates to yyyymmdd', () => {
    expect(tallyDate('2026-04-05')).toBe('20260405');
  });
});

describe('tally validation', () => {
  it('passes a clean bundle', () => {
    const b = buildBundle();
    const issues = validateBundle(b.ledgers, b.vouchers);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects unbalanced vouchers and missing masters', () => {
    const b = buildBundle();
    b.vouchers[0].entries[0].amount += 10; // break balance
    b.vouchers.push({
      date: '2026-04-09',
      voucherType: 'Journal',
      voucherNumber: 'JE-X',
      partyLedgerName: 'Ghost Ledger',
      narration: '',
      entries: [
        { ledgerName: 'Ghost Ledger', isDebit: true, amount: 100 },
        { ledgerName: 'Cash', isDebit: false, amount: 100 },
      ],
    });
    const issues = validateBundle(b.ledgers, b.vouchers);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.some((e) => e.message.includes('not balanced'))).toBe(true);
    expect(errors.some((e) => e.message.includes('Ghost Ledger'))).toBe(true);
  });
});
