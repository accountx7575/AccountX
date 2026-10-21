import { describe, it, expect } from 'vitest';
import { parseBillText, normalizeDate } from './billParser';

const CLEAN_BILL = `
SHREE BALAJI TRADERS
Address: 12 Market Road, Pune 411001
GSTIN: 27ABCDE1234F1Z5
Phone: 9876543210

TAX INVOICE
Invoice No: SB/2026-27/0042
Invoice Date: 05/10/2026
Due Date: 20/10/2026

Description                    Qty      Rate      Amount
Cement Bag 50kg                 10    280.00     2800.00
Steel Rod 10mm                   5    450.00     2250.00  18%
River Sand                       2   1200.00     2400.00

Sub Total                                7450.00
CGST 9%                                   670.50
SGST 9%                                   670.50
Grand Total                             8791.00
`;

const MESSY_BILL = `
M/s Verma Steel Works
GSTIN: 09AAECV1234M1Z8
Bill No. VS-0091                    Dated 12-03-2026
Bill Amount Payable: Rs. 12,450.00
Particulars                      Qty    Rate    Amount
TMT Bar 10mm                       20   550.00  11000.00
Angle 50x50x6                       4   362.50   1450.00
`;

const HEADER_ONLY = `
ACME INDUSTRIES
GSTIN 33AABCA1234C1Z9
Invoice No: ACME/99
Invoice Date: 01/01/2026
Total 5000.00
`;

/** God���s fixture: a sub-total-then-total bill with an address line next to
 *  the item rows and a single summary GST row. */
const REALISTIC_BILL = `
VERMA STEEL WORKS
121, Khasra No-170 and Khata No-00186, Sector 9
GSTIN: 09ABCDE1234F1Z5

TAX INVOICE
Bill No: PB/26-27/1
Bill Date: 12-03-2026
Due Date: 27-03-2026

Description                 Qty       Rate       Amount
TMT Bar 10mm                 20      550.00     11000.00
Angle 50x50x6                 4      362.50      1450.00

Sub Total                           24500.00
GST 18%                             4410.00
Total                              28910.00
`;

/** Same shape, but the rows really do add up to the sub total. */
const CONSISTENT_BILL = `
VERMA STEEL WORKS
GSTIN: 09ABCDE1234F1Z5

TAX INVOICE
Bill No: PB/26-27/1
Bill Date: 12-03-2026

Description                 Qty       Rate       Amount
TMT Bar 10mm                 20      550.00     11000.00
Angle 50x50x6                 4     3375.00     13500.00

Sub Total                           24500.00
GST 18%                             4410.00
Total                              28910.00
`;

describe('normalizeDate', () => {
  it('reads Indian dd/mm/yyyy', () => {
    expect(normalizeDate('05/10/2026')).toBe('2026-10-05');
  });

  it('swaps to dd/mm when the first part cannot be a month', () => {
    expect(normalizeDate('12/03/2026')).toBe('2026-03-12');
  });

  it('expands two digit years', () => {
    expect(normalizeDate('05-10-26')).toBe('2026-10-05');
  });

  it('rejects impossible dates', () => {
    expect(normalizeDate('45/10/2026')).toBeUndefined();
  });
});

/** The common Indian layout: a sub total, two tax rows and the payable total. */
const SUBTOTAL_THEN_TOTAL = `
Sub Total            100.00
CGST 9%                4.50
SGST 9%                4.50
Total                 109.00
`;

/** Same shape, but the sub total is hyphenated. */
const SUBTOTAL_HYPHEN_THEN_TOTAL = `
Sub-Total          100.00
CGST 9%                4.50
SGST 9%                4.50
Total                 109.00
`;

/** A sub total only, no 'Total' line — the payable total is absent. */
const SUBTOTAL_ONLY = `
Sub-Total          100.00
CGST 9%                4.50
SGST 9%                4.50
`;

/** Same, spelled with a space. */
const SUBTOTAL_ONLY_SPACED = `
Sub Total            100.00
CGST 9%                4.50
SGST 9%                4.50
`;

/** The common Indian layout with rows: sub total, CGST + SGST, then total. */
const SUBTOTAL_CGST_SGST_TOTAL = `
VERMA STEEL WORKS
GSTIN: 09ABCDE1234F1Z5

Bill No: PB/26-27/9
Bill Date: 12-03-2026

Description                 Qty       Rate       Amount
TMT Bar 10mm                 1      100.00      100.00

Sub Total            100.00
CGST 9%                4.50
SGST 9%                4.50
Total                 109.00
`;

describe('parseBillText', () => {
  it('reads the header fields of a clean bill', () => {
    const parsed = parseBillText(CLEAN_BILL);
    expect(parsed.billNumber).toBe('SB/2026-27/0042');
    expect(parsed.billDate).toBe('2026-10-05');
    expect(parsed.dueDate).toBe('2026-10-20');
    expect(parsed.supplierGstin).toBe('27ABCDE1234F1Z5');
    expect(parsed.supplierName).toBeTruthy();
    expect(parsed.totalAmount).toBe(8791);
  });

  it('reads the line items with qty, rate and tax', () => {
    const parsed = parseBillText(CLEAN_BILL);
    expect(parsed.items.length).toBe(3);
    const cement = parsed.items.find((i) => /Cement/i.test(i.name));
    expect(cement).toBeDefined();
    expect(cement?.quantity).toBe(10);
    expect(cement?.rate).toBe(280);
    const steel = parsed.items.find((i) => /Steel Rod/i.test(i.name));
    expect(steel?.taxRate).toBe(18);
    expect(steel?.quantity).toBe(5);
    expect(steel?.rate).toBe(450);
  });

  it('never returns total lines as items', () => {
    const parsed = parseBillText(CLEAN_BILL);
    for (const item of parsed.items) {
      expect(item.name).not.toMatch(/^(sub\s*total|total|cgst|sgst|grand\s*total)/i);
    }
  });

  it('handles messy OCR text with Rs. amounts and a M/s supplier', () => {
    const parsed = parseBillText(MESSY_BILL);
    expect(parsed.billNumber).toBe('VS-0091');
    expect(parsed.billDate).toBe('2026-03-12');
    expect(parsed.supplierGstin).toBe('09AAECV1234M1Z8');
    expect(parsed.totalAmount).toBe(12450);
    expect(parsed.items.length).toBe(2);
    expect(parsed.items[0].quantity).toBe(20);
    expect(parsed.items[0].rate).toBe(550);
  });

  it('returns no items for a header-only bill instead of guessing', () => {
    const parsed = parseBillText(HEADER_ONLY);
    expect(parsed.items.length).toBe(0);
    expect(parsed.billNumber).toBe('ACME/99');
  });

  it('is safe on empty or garbage input', () => {
    const parsed = parseBillText('');
    expect(parsed.items).toEqual([]);
    expect(parsed.billNumber).toBeUndefined();
    expect(parseBillText('   \n  ').items).toEqual([]);
  });

  it('does not treat the GSTIN as a bill number', () => {
    const parsed = parseBillText(HEADER_ONLY);
    expect(parsed.billNumber).not.toContain('33AABCA1234C1Z9');
  });

  it('repairs the "Z" of a GSTIN that OCR read as "2"', () => {
    const ocr = CLEAN_BILL.replace('27ABCDE1234F1Z5', '27ABCDE1234F125');
    const parsed = parseBillText(ocr);
    expect(parsed.supplierGstin).toBe('27ABCDE1234F1Z5');
  });
});

describe('parseBillText — subtotal, address and summary tax', () => {
  it('reads the payable total, not the sub total', () => {
    const parsed = parseBillText(REALISTIC_BILL);
    // Sub Total 24500.00 must never win over Total 28910.00
    expect(parsed.totalAmount).toBe(28910);
  });

  it('never turns the supplier address into a line item', () => {
    const parsed = parseBillText(REALISTIC_BILL);
    expect(parsed.items.length).toBe(2);
    for (const item of parsed.items) {
      expect(item.name).not.toMatch(/khasra|khata|sector/i);
    }
    expect(parsed.items.every((i) => i.rate > 0)).toBe(true);
  });

  it('allocates a single summary GST row across the items', () => {
    const parsed = parseBillText(REALISTIC_BILL);
    expect(parsed.summaryTax?.rate).toBe(18);
    expect(parsed.summaryTax?.amount).toBe(4410);
    for (const item of parsed.items) {
      expect(item.taxRate).toBe(18);
    }
  });

  it('makes the item total add up to the bill total', () => {
    // A bill whose rows really do add up to the sub total: 24500 + 18% = 28910
    const parsed = parseBillText(CONSISTENT_BILL);
    const taxable = parsed.items.reduce((s, i) => s + i.quantity * i.rate, 0);
    const tax = parsed.items.reduce((s, i) => s + i.quantity * i.rate * (i.taxRate / 100), 0);
    expect(taxable).toBe(24500);
    expect(Math.round((taxable + tax) * 100) / 100).toBe(28910);
    expect(parsed.totalAmount).toBe(28910);
  });

  it('keeps a per-item tax rate when the bill has one', () => {
    const parsed = parseBillText(CLEAN_BILL);
    const steel = parsed.items.find((i) => /Steel Rod/i.test(i.name));
    expect(steel?.taxRate).toBe(18);
  });
});

describe('parseBillText — sub total then total', () => {
  it('returns the payable total, never the sub total', () => {
    const parsed = parseBillText(SUBTOTAL_THEN_TOTAL);
    expect(parsed.totalAmount).toBe(109);
    expect(parsed.totalAmount).not.toBe(100);
  });

  it('returns the payable total when the sub total is hyphenated', () => {
    const parsed = parseBillText(SUBTOTAL_HYPHEN_THEN_TOTAL);
    expect(parsed.totalAmount).toBe(109);
    expect(parsed.totalAmount).not.toBe(100);
  });

  it('never reports a sub total as the total', () => {
    // No 'Total' line on the bill: the payable figure is simply not there,
    // so it must stay empty rather than become the sub total.
    expect(parseBillText(SUBTOTAL_ONLY).totalAmount).toBeUndefined();
    expect(parseBillText(SUBTOTAL_ONLY_SPACED).totalAmount).toBeUndefined();
    expect(parseBillText(SUBTOTAL_ONLY).totalAmount).not.toBe(100);
  });

  it('sums the CGST and SGST rows into the effective tax rate', () => {
    const parsed = parseBillText(SUBTOTAL_CGST_SGST_TOTAL);
    expect(parsed.totalAmount).toBe(109);
    expect(parsed.totalAmount).not.toBe(100);
    expect(parsed.summaryTax?.amount).toBe(9);
    // 4.50 + 4.50 of tax on a 100.00 row is 9% — the row must not stay at 0%
    expect(parsed.items[0].taxRate).toBe(9);
    // 100.00 + 9.00 of tax = the 109.00 the bill shows
    const taxable = parsed.items.reduce((s, i) => s + i.quantity * i.rate, 0);
    const tax = parsed.items.reduce((s, i) => s + i.quantity * i.rate * (i.taxRate / 100), 0);
    expect(Math.round((taxable + tax) * 100) / 100).toBe(109);
  });
});

/**
 * What the OCR really returned for the same bill: the quantity column came
 * back as "f:" so the row carries only two numbers, and the tax base has to
 * come from the bill's printed sub total, not from the imported rows.
 */
const OCR_ROW_WITHOUT_QTY = `
VERMA STEEL WORKS

GSTIN: 09ABCDE1234F1Z5

TAX INVOICE

Bill No: PB/26-27/9

Bill Date: 12-03-2026

Description oty Rate Amount.
TMT Bar 10mm f: 100.00 100.00
Sub Total 100.00

CGST 9% 4.50

SGST 9% 4.50

Total 109.00
`;

/** The same bill without the sub total line — no printed taxable value. */
const CGST_SGST_WITHOUT_SUBTOTAL = `
VERMA STEEL WORKS
GSTIN: 09ABCDE1234F1Z5

Bill No: PB/26-27/9
Bill Date: 12-03-2026

Description                 Qty       Rate       Amount
TMT Bar 10mm                 1      100.00      100.00

CGST 9%                4.50
SGST 9%                4.50
Total                 109.00
`;

describe('parseBillText — a row that lost its quantity column', () => {
  it('reads the two numbers as rate and amount when the quantity is gone', () => {
    const parsed = parseBillText(OCR_ROW_WITHOUT_QTY);
    expect(parsed.items.length).toBe(1);
    expect(parsed.items[0].rate).toBe(100);
    expect(parsed.items[0].amount).toBe(100);
    expect(parsed.totalAmount).toBe(109);
  });

  it('derives the effective tax rate from the printed sub total', () => {
    const parsed = parseBillText(OCR_ROW_WITHOUT_QTY);
    expect(parsed.summaryTax?.amount).toBe(9);
    // 9.00 of tax on the bill's printed 100.00 base is 9% — not 0.09% from a
    // mis-read quantity column
    expect(parsed.items[0].taxRate).toBe(9);
  });

  it('falls back to the imported rows when the bill prints no taxable value', () => {
    const parsed = parseBillText(CGST_SGST_WITHOUT_SUBTOTAL);
    expect(parsed.items[0].amount).toBe(100);
    expect(parsed.items[0].taxRate).toBe(9);
  });
});
