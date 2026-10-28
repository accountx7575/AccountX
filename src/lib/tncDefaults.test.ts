// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  STANDARD_TNC_DEFAULTS,
  resolveDocumentTnc,
  resolveDocumentTncLines,
  resolveTermsLines,
  saveTncCache,
  readTncCache,
} from './tncDefaults';

describe('tncDefaults', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides the standard 3 clauses for payment_receipt', () => {
    const defaults = STANDARD_TNC_DEFAULTS.payment_receipt;
    expect(defaults).toContain('All payments are subject to realization of cheque / electronic transfer.');
    expect(defaults).toContain('Any discrepancy must be reported to the accounts department within 7 days.');
    expect(defaults).toContain('This is a computer-generated receipt.');
  });

  it('resolves payment receipt terms from business tnc_payment_receipt or terms_payment_receipt', () => {
    expect(
      resolveDocumentTnc('payment_receipt', { tnc_payment_receipt: 'Custom receipt clause' })
    ).toBe('Custom receipt clause');

    expect(
      resolveDocumentTnc('payment_receipt', { terms_payment_receipt: 'Alternative receipt clause' })
    ).toBe('Alternative receipt clause');

    expect(
      resolveDocumentTnc('payment_receipt', { termsPaymentReceipt: 'CamelCase receipt clause' })
    ).toBe('CamelCase receipt clause');
  });

  it('resolves fallback from localStorage cache if DB field is empty', () => {
    saveTncCache('biz-42', {
      sales_invoice: '',
      quotation: '',
      sales_order: '',
      purchase: '',
      payment_receipt: 'Cached offline receipt clause',
    });

    expect(readTncCache('biz-42', 'payment_receipt')).toBe('Cached offline receipt clause');
    expect(resolveDocumentTnc('payment_receipt', { id: 'biz-42' })).toBe('Cached offline receipt clause');
  });

  it('resolveTermsLines prioritizes document override, then business setting, or returns empty array for caller default fallback', () => {
    // 1. Document override
    expect(
      resolveTermsLines('payment_receipt', { terms_payment_receipt: 'Biz term' }, 'Doc override term')
    ).toEqual(['Doc override term']);

    // 2. Business setting
    expect(
      resolveTermsLines('payment_receipt', { terms_payment_receipt: 'Line 1\nLine 2' }, '')
    ).toEqual(['Line 1', 'Line 2']);

    // 3. Unconfigured business and empty document returns empty array (allowing print engines to fallback to legacy/standard defaults)
    expect(
      resolveTermsLines('payment_receipt', null, '')
    ).toEqual([]);
  });
});
