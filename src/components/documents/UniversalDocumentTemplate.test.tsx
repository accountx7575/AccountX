/**
 * PBS-158 / header reset regression: the top header must be a TWO-CELL TABLE.
 *
 * The human reported the header as mangled — "Expected On", "Time" and
 * "Place of Supply" collapsed into the middle of the page and the company
 * details were merged across lines. The cause was CSS grid: a grid re-flows
 * its cells, so a short cell lets the next cell slide into the empty column.
 * A table cell owns its own lines, so the left cell can only hold company
 * details and the right cell only document metadata.
 *
 * Geometry is measured in a real browser; this test locks the structure so
 * the two-column contract cannot silently regress.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UniversalDocumentTemplate,
  type DocumentType,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

const TYPES: DocumentType[] = [
  'SALES_ORDER',
  'QUOTATION',
  'TAX_INVOICE',
  'PURCHASE_ORDER',
  'PURCHASE_BILL',
];

function fixture(
  documentType: DocumentType,
  demoHeader?: UniversalDocumentData['demoHeader']
): UniversalDocumentData {
  return {
    documentType,
    documentNumber: 'SO-001',
    date: '21/10/2026',
    time: '05:45 PM',
    placeOfSupply: 'Uttar Pradesh (09)',
    seller: {
      name: 'VERMA STEEL WORKS',
      address: '12, Industrial Estate',
      city: 'Kanpur',
      state: 'Uttar Pradesh',
      pincode: '208012',
      gstin: '09ABCDE1234F1Z5',
      email: 'support@verma.example',
      phone: '9876543210',
    },
    buyer: {
      name: 'KASHYAP TRADERS',
      address: '44, Gandhi Road',
      city: 'Kanpur',
      state: 'Uttar Pradesh',
      pincode: '208012',
      gstin: '09XXXXX9999A1Z5',
    },
    items: [
      { id: '1', name: 'TMT BAR 10MM', hsnSac: '7214', quantity: 10, rate: 50, taxRate: 18, total: 500 },
    ],
    subtotal: 500,
    cgstAmount: 45,
    sgstAmount: 45,
    grandTotal: 590,
    amountInWords: 'Five Hundred Ninety Rupees Only',
    ...(demoHeader ? { demoHeader } : {}),
  };
}

const headerTable = (html: string): string => {
  const table = html.match(/<table[^>]*>[\s\S]*?<\/table>/);
  expect(table).toBeTruthy();
  return table![0];
};

const headerCells = (html: string): { left: string; right: string } => {
  const cells = headerTable(html).match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
  expect(cells.length).toBe(2);
  return { left: cells[0], right: cells[1] };
};

describe('UniversalDocumentTemplate — header is a two-cell table', () => {
  it.each(TYPES)('renders exactly two header cells for %s', (type) => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture(type)} />);
    const { left, right } = headerCells(html);
    expect(left).toContain('width:55%');
    expect(right).toContain('width:45%');
    expect(left).toContain('vertical-align:top');
    expect(right).toContain('vertical-align:top');
  });

  it('uses no CSS grid for the header', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture('SALES_ORDER')} />);
    const table = headerTable(html);
    expect(table).not.toContain('grid-cols-2');
    expect(table).not.toContain('display:grid');
    expect(table).not.toContain('display: grid');
  });

  it('keeps every date and time field inside the right cell', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture('SALES_ORDER')} />);
    const { left, right } = headerCells(html);
    for (const marker of ['Date:', 'Expected Delivery:', 'Time:', 'Place of Supply:', 'Order No:']) {
      expect(right, `${marker} must be in the right cell`).toContain(marker);
      expect(left, `${marker} must not leak into the left cell`).not.toContain(marker);
    }
  });

  it('keeps the company details inside the left cell', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture('SALES_ORDER')} />);
    const { left, right } = headerCells(html);
    for (const marker of ['VERMA STEEL WORKS', '12, Industrial Estate', 'Kanpur, Uttar Pradesh - 208012', 'GSTIN:', 'PAN:', 'support:', 'Phone:']) {
      expect(left, `${marker} must be in the left cell`).toContain(marker);
      expect(right, `${marker} must not leak into the right cell`).not.toContain(marker);
    }
  });

  it('aligns the left cell left and the right cell right', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture('SALES_ORDER')} />);
    const { left, right } = headerCells(html);
    expect(left).toContain('text-align:left');
    expect(right).toContain('text-align:right');
  });

  it('has no centre alignment and no auto margins in the header', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={fixture('SALES_ORDER')} />);
    const table = headerTable(html);
    expect(table).not.toContain('text-center');
    expect(table).not.toContain('mx-auto');
  });
});

// The document header used to render the date and the expected/delivery date
// on ONE line ('Date: 21/10/2026 | Expected On: 2026-10-22'), and the expected
// date leaked through as a raw ISO string. Each meta line gets its own row now,
// and every date prints as strict Indian DD/MM/YYYY.
describe('UniversalDocumentTemplate — date and expected date on their own rows', () => {
  const withExpected = (dueDate?: string) => ({
    ...fixture('SALES_ORDER'),
    ...(dueDate ? { dueDate } : {}),
  }) as UniversalDocumentData;

  it('puts the date on its own row and the expected date on the next one', () => {
    const html = renderToStaticMarkup(
      <UniversalDocumentTemplate data={withExpected('22/10/2026')} />
    );
    const { right } = headerCells(html);
    expect(right).toMatch(/Date: 21\/10\/2026/);
    expect(right).toMatch(/Expected Delivery: 22\/10\/2026/);
  });

  it('never joins the two dates on one line with a pipe', () => {
    const html = renderToStaticMarkup(
      <UniversalDocumentTemplate data={withExpected('22/10/2026')} />
    );
    expect(html).not.toMatch(/Date: [^<]*\|/);
  });

  it('formats a raw ISO expected date as DD/MM/YYYY', () => {
    const html = renderToStaticMarkup(
      <UniversalDocumentTemplate data={withExpected('2026-10-22')} />
    );
    expect(html).toMatch(/Expected Delivery: 22\/10\/2026/);
    expect(html).not.toContain('2026-10-22');
  });

  it('omits the expected row when the document has no expected date', () => {
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={withExpected()} />);
    expect(html).not.toContain('Expected Delivery');
    expect(html).toMatch(/Date: 21\/10\/2026/);
  });

  it('omits the time row when the document has no time', () => {
    const data = { ...fixture('SALES_ORDER'), time: undefined } as UniversalDocumentData;
    const html = renderToStaticMarkup(<UniversalDocumentTemplate data={data} />);
    expect(html).not.toContain('Time:');
  });
});
