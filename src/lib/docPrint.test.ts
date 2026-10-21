import { describe, it, expect } from 'vitest';
import { generateOmStyleHtml, type PrintableDocData } from './docPrint';

const baseDoc = {
  docTitle: 'TAX INVOICE',
  docNumber: 'INV-0001',
  dateValue: '2026-01-01',
  items: [],
  grandTotal: 0,
  subtotal: 0,
  taxAmount: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  balanceAmount: 0,
  paidAmount: 0,
} as unknown as PrintableDocData;

describe('docPrint — demo watermark gating with caveat', () => {
  it('live docs never emit the watermark div nor a literal null via the && idiom', () => {
    const html = generateOmStyleHtml({ name: 'Pub', logo_url: 'x' }, { ...baseDoc, demoHeader: undefined });
    expect(html).not.toContain('class="demo-wm"');
    expect(html.startsWith('null')).toBe(false);
    expect(html).not.toMatch(/>null<|(^|>)null\$\{/);
  });

  it('estimate demo docs render the ESTIMATE watermark', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, demoHeader: 'estimate' });
    expect(html).toContain('demo-wm');
    expect(html).toContain('>ESTIMATE<');
  });
});
