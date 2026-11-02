import { describe, it, expect } from 'vitest';
import {
  currentDocumentPrefix,
  currentFinancialYearShort,
  financialYearShort,
  syncDocumentNumberWithCurrentPrefix,
} from './numberingSync';

describe('financialYearShort', () => {
  it('converts the full settings form (2026-27) to the short form used on documents', () => {
    expect(financialYearShort('2026-27')).toBe('26-27');
  });

  it('keeps an already-short financial year', () => {
    expect(financialYearShort('26-27')).toBe('26-27');
  });

  it('falls back to the financial year embedded in the current document number', () => {
    expect(financialYearShort('', 'QT/25-26/4')).toBe('25-26');
  });

  it('falls back to the current Indian financial year', () => {
    expect(financialYearShort('', '', new Date('2026-10-01T00:00:00Z'))).toBe('26-27');
    expect(financialYearShort('', '', new Date('2026-02-01T00:00:00Z'))).toBe('25-26');
  });
});

describe('currentFinancialYearShort', () => {
  it('rolls over on 1 April', () => {
    expect(currentFinancialYearShort(new Date('2026-03-31T12:00:00Z'))).toBe('25-26');
    expect(currentFinancialYearShort(new Date('2026-04-01T12:00:00Z'))).toBe('26-27');
  });
});

describe('currentDocumentPrefix', () => {
  it('prefers the configured settings prefix', () => {
    expect(currentDocumentPrefix({ quotation_prefix: 'QT/ABC/SE' }, 'quotation')).toBe('QT/ABC/SE');
  });

  it('strips trailing slashes and falls back to the built-in default', () => {
    expect(currentDocumentPrefix({ sales_order_prefix: 'SO/ABC/SE/' }, 'sales_order')).toBe('SO/ABC/SE');
    expect(currentDocumentPrefix({}, 'sales_order')).toBe('SO');
  });
});

describe('syncDocumentNumberWithCurrentPrefix', () => {
  it('replaces the old prefix while keeping the financial year and sequence', () => {
    expect(
      syncDocumentNumberWithCurrentPrefix({
        docType: 'quotation',
        currentDocNumber: 'QT/26-27/2',
        businessSettings: { quotation_prefix: 'QT/ABC/SE', financial_year: '2026-27' },
      })
    ).toBe('QT/ABC/SE/26-27/2');
  });

  it('works for every supported document type', () => {
    const cases = [
      ['sales_order', 'SO/26-27/1', 'sales_order_prefix', 'SO/ABC/SE', 'SO/ABC/SE/26-27/1'],
      ['quotation', 'QT/26-27/2', 'quotation_prefix', 'QT/ABC/SE', 'QT/ABC/SE/26-27/2'],
      ['sales_invoice', 'INV/26-27/3', 'invoice_prefix', 'INV/ABC/SE', 'INV/ABC/SE/26-27/3'],
      ['purchase_order', 'PO/26-27/4', 'purchase_order_prefix', 'PO/ABC/SE', 'PO/ABC/SE/26-27/4'],
      ['purchase_bill', 'PB/26-27/5', 'purchase_bill_prefix', 'PB/ABC/SE', 'PB/ABC/SE/26-27/5'],
    ] as const;

    for (const [docType, currentDocNumber, key, prefix, expected] of cases) {
      expect(
        syncDocumentNumberWithCurrentPrefix({
          docType,
          currentDocNumber,
          businessSettings: { [key]: prefix, financial_year: '2026-27' },
        })
      ).toBe(expected);
    }
  });

  it('preserves leading zeros in the sequence', () => {
    expect(
      syncDocumentNumberWithCurrentPrefix({
        docType: 'sales_order',
        currentDocNumber: 'SO/26-27/0007',
        businessSettings: { sales_order_prefix: 'SO/ABC/SE', financial_year: '2026-27' },
      })
    ).toBe('SO/ABC/SE/26-27/0007');
  });

  it('is idempotent when the document already uses the current prefix', () => {
    expect(
      syncDocumentNumberWithCurrentPrefix({
        docType: 'sales_order',
        currentDocNumber: 'SO/ABC/SE/26-27/1',
        businessSettings: { sales_order_prefix: 'SO/ABC/SE', financial_year: '2026-27' },
      })
    ).toBe('SO/ABC/SE/26-27/1');
  });

  it('derives the financial year from the document when settings omit it', () => {
    expect(
      syncDocumentNumberWithCurrentPrefix({
        docType: 'sales_order',
        currentDocNumber: 'SO/25-26/9',
        businessSettings: { sales_order_prefix: 'SO/NEW' },
      })
    ).toBe('SO/NEW/25-26/9');
  });

  it('ignores an unparseable settings financial year', () => {
    expect(
      syncDocumentNumberWithCurrentPrefix({
        docType: 'quotation',
        currentDocNumber: 'QT/26-27/2',
        businessSettings: { quotation_prefix: 'QT/ABC/SE', financial_year: 'not-a-year' },
      })
    ).toBe('QT/ABC/SE/26-27/2');
  });

  it('throws when the current number has no trailing sequence', () => {
    expect(() =>
      syncDocumentNumberWithCurrentPrefix({
        docType: 'sales_order',
        currentDocNumber: 'SO/26-27/DRAFT',
        businessSettings: { sales_order_prefix: 'SO/ABC/SE', financial_year: '2026-27' },
      })
    ).toThrow(/no trailing sequence/i);
  });
});
