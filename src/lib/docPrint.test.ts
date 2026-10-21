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

// PBS-158 — the header badge cell once carried a class with no matching rule
// ('h-right' alone), so the pill fell back to text-align:left and rendered in
// the middle of the page. Guard the invariant structurally: every class on the
// badge cell must be DEFINED in the emitted stylesheet, the badge must be
// right-aligned by its own rule, and no centred class may creep back in.
describe('docPrint — header badge alignment (PBS-158)', () => {
  const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';

  const rulesOf = (style: string) => {
    const rules: Array<{ selector: string; body: string }> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(style))) rules.push({ selector: m[1].trim(), body: m[2] });
    return rules;
  };

  const badgeCellOf = (html: string) =>
    html.match(/<div class="([^"]+)">\s*<div class="doc-pill"/)?.[1] ?? '';

  const docTypes: Array<[string, string]> = [
    ['QUOTATION', 'QUOTATION'],
    ['SALES ORDER', 'SALES ORDER'],
    ['TAX INVOICE', 'TAX INVOICE'],
    ['PURCHASE ORDER', 'PURCHASE ORDER'],
    ['PURCHASE BILL', 'PURCHASE BILL'],
  ];

  it('badge cell uses only classes that are DEFINED in the emitted stylesheet', () => {
    for (const [label, docTitle] of docTypes) {
      const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, docTitle });
      const style = styleOf(html);
      const classes = badgeCellOf(html).split(/\s+/).filter(Boolean);
      expect(classes.length, `${label}: badge cell must carry classes`).toBeGreaterThan(0);
      for (const cls of classes) {
        const defined = rulesOf(style).some((r) => r.selector.split(/\s*,\s*/).includes(`.${cls}`));
        expect(defined, `${label}: class '.${cls}' has no rule in the stylesheet`).toBe(true);
      }
    }
  });

  it('badge cell is right-aligned by its own rule and never centred', () => {
    for (const [label, docTitle] of docTypes) {
      const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, docTitle });
      const rules = rulesOf(styleOf(html));
      const classes = badgeCellOf(html).split(/\s+/).filter(Boolean);

      expect(classes, `${label}: badge cell must use the h-badge hook`).toContain('h-badge');

      const badgeRule = rules.find((r) => r.selector === '.h-badge');
      expect(badgeRule, `${label}: '.h-badge' rule missing`).toBeTruthy();
      expect(badgeRule!.body, `${label}: badge must be flush right`).toMatch(/justify-content:\s*flex-end/);
      expect(badgeRule!.body, `${label}: badge must not be centred`).not.toMatch(/justify-content:\s*center/);

      for (const cls of classes) {
        expect(cls, `${label}: centred class on badge cell`).not.toMatch(/center|mx-auto/i);
      }
      expect(styleOf(html), `${label}: pill must not be text-centred`).not.toMatch(/\.doc-pill\s*\{[^}]*text-align:\s*center/);
      expect(rules.find((r) => r.selector === '.doc-pill')!.body).toMatch(/text-align:\s*right/);
    }
  });

  it('the shared .h-right rule stays a plain text rule so the meta lines never split', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, docTitle: 'SALES ORDER' });
    const rules = rulesOf(styleOf(html));
    const rightRule = rules.find((r) => r.selector === '.h-right');
    expect(rightRule, "'.h-right' rule missing").toBeTruthy();
    expect(rightRule!.body, "'.h-right' must not become a flex/grid container").not.toMatch(/display:\s*(flex|grid|inline-flex)/);
    expect(rightRule!.body).toMatch(/text-align:\s*right/);
    // The 4 meta lines keep the compound class that actually right-aligns them.
    expect((html.match(/class="h-line h-right"/g) ?? []).length).toBe(4);
  });

  // PBS-158 addendum — 'QUOTE' is not a substring of 'QUOTATION', so every
  // quotation fell through to the final else and printed 'Invoice No'.
  it('each doc type prints its own number label and never a foreign one', () => {
    const expected: Array<[string, string, string]> = [
      ['QUOTATION', 'QUOTATION', 'Quotation No'],
      ['SALES ORDER', 'SALES ORDER', 'Order No'],
      ['PURCHASE ORDER', 'PURCHASE ORDER', 'PO No'],
      ['PURCHASE BILL', 'PURCHASE BILL', 'Bill No'],
      ['TAX INVOICE', 'TAX INVOICE', 'Invoice No'],
    ];
    const allLabels = ['Quotation No', 'Order No', 'PO No', 'Bill No', 'Invoice No'];
    for (const [label, docTitle, want] of expected) {
      const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, docTitle });
      const printed = (html.match(/class="lbl">([^<]+):<\/span>/g) ?? []).filter((l) =>
        allLabels.some((a) => l.includes(`>${a}:`)),
      );
      expect(printed.length, `${label}: expected exactly one number label`).toBe(1);
      expect(printed[0], `${label}: number label`).toContain(`>${want}:`);
    }
  });
});

// The document header used to print the date and the expected/delivery date on
// ONE line ('Date: 21/10/2026 | Expected On: 2026-10-22'), and the expected
// date came straight from the database as a raw ISO string.
describe('docPrint — date and expected date on their own rows', () => {
  const withExpiry = {
    ...baseDoc,
    docTitle: 'SALES ORDER',
    dateValue: '21/10/2026',
    expiryLabel: 'Expected On',
    expiryValue: '2026-10-22',
  } as unknown as PrintableDocData;

  it('prints the date and the expected date as two separate right-aligned rows', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, withExpiry);
    expect(html).toContain(
      '<div class="h-line h-right"><span class="lbl">Date:</span> <strong>21/10/2026</strong></div>',
    );
    expect(html).toContain(
      '<div class="h-line h-right"><span class="lbl">Expected On:</span> <strong>22/10/2026</strong></div>',
    );
  });

  it('never joins the two dates with a pipe on one line', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, withExpiry);
    expect(html).not.toMatch(/Date:<\/span> <strong>[^<]*<\/strong>\s*\|/);
  });

  it('prints the expected date as DD/MM/YYYY, never as a raw ISO date', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, withExpiry);
    expect(html).toContain('22/10/2026');
    expect(html).not.toContain('2026-10-22');
  });

  it('omits the expected row entirely when the document has no expected date', () => {
    const html = generateOmStyleHtml({ name: 'Pub' }, { ...baseDoc, dateValue: '21/10/2026' });
    expect(html).not.toContain('Valid Until');
    expect(html).toContain(
      '<div class="h-line h-right"><span class="lbl">Date:</span> <strong>21/10/2026</strong></div>',
    );
  });
});

