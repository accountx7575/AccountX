import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const DRIFT = 'UDT drifted from approved design - needs human approval';
const UDT_REL = 'components/documents/UniversalDocumentTemplate.tsx';
const APPROVED_UDT_BYTES = 62569;
const APPROVED_UDT_SHA1 = '9c64da862e5cb83542e149f0dc1d977f5c0590c3';

const DETAIL_PAGES = [
  'pages/SalesOrderDetailPage.tsx',
  'pages/QuotationViewPage.tsx',
  'pages/PurchaseBillViewPage.tsx',
  'pages/PurchaseOrderViewPage.tsx',
  'pages/SalesInvoiceViewPage.tsx',
];

const LIST_PAGES = [
  'pages/SalesOrdersPage.tsx',
  'pages/QuotationsPage.tsx',
  'pages/PurchaseBillsPage.tsx',
  'pages/SalesInvoicesPage.tsx',
  'pages/PurchaseOrdersPage.tsx',
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const SOURCE_FILES = walk(SRC).map((full) => ({
  rel: full.slice(SRC.length + 1),
  text: readFileSync(full, 'utf8'),
}));

const filesMatching = (re: RegExp) =>
  SOURCE_FILES.filter((file) => re.test(file.text)).map((file) => file.rel);

describe('document engine contract (directive-11 forward guard)', () => {
  it('docPrint exports the UDT-backed surface and no legacy generator', () => {
    const engine = read('lib/docPrint.tsx');

    expect(engine).toMatch(/export\s+interface\s+PrintableDocData\b/);
    for (const name of [
      'classifyDocumentType',
      'mapPrintableDocToUniversalData',
      'renderDocSheetToPdf',
      'renderDocSheetToPdfBlob',
    ]) {
      expect(engine).toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`));
    }
    const exportNames = Array.from(
      engine.matchAll(/export\s+(?:interface|type|const|class|async\s+function|function)\s+(\w+)/g)
    )
      .map((match) => match[1])
      .sort();
    expect(exportNames).toEqual([
      'PrintableDocData',
      'classifyDocumentType',
      'mapPrintableDocToUniversalData',
      'renderDocSheetToPdf',
      'renderDocSheetToPdfBlob',
    ].sort());

    expect(engine.toLowerCase()).not.toContain('generateomstylehtml');
    for (const marker of ['<table', '<html', '<style', '<!doctype']) {
      expect(engine.toLowerCase()).not.toContain(marker);
    }
    expect(engine).toContain('<UniversalDocumentTemplate');
    expect(engine.length).toBeGreaterThan(5000);
  });

  it('the certified UDT is the only template module in src', () => {
    expect(filesMatching(/export\s+(const|function)\s+UniversalDocumentTemplate\b/)).toEqual([
      'components/documents/UniversalDocumentTemplate.tsx',
    ]);
    expect(filesMatching(/export\s+(const|function)\s+printElementInIframe\b/)).toEqual([
      'components/documents/UniversalDocumentTemplate.tsx',
    ]);
  });

  it('pins the approved GyftKart UDT fingerprint', () => {
    const bytes = readFileSync(join(SRC, UDT_REL));
    expect(bytes.length, DRIFT).toBe(APPROVED_UDT_BYTES);
    expect(createHash('sha1').update(bytes).digest('hex'), DRIFT).toBe(APPROVED_UDT_SHA1);
  });

  it('keeps the approved layout markers (7-column table, pill, dual cards, signatory)', () => {
    const udt = read(UDT_REL);

    expect(udt).toContain('TAX INVOICE / RECEIPT');
    for (const header of [
      'Item Description / Voucher',
      'HSN/SAC',
      'Qty',
      'Unit Rate (₹)',
      'Tax (GST)',
      'Total (₹)',
    ]) {
      expect(udt, header).toContain(header);
    }
    expect(udt).toContain('Billed To');
    expect(udt).toContain('Payment &amp; Fulfillment');
    expect(udt).toContain('numberToWordsINR');
    expect(udt).toContain('Authorized Signatory');
  });

  it('every detail/view page renders only UDT under invoice-printable-area', () => {
    for (const rel of DETAIL_PAGES) {
      const page = read(rel);
      expect(page, rel).toContain('<UniversalDocumentTemplate');
      expect(page, rel).toContain('id="invoice-printable-area"');
      expect(page, rel).not.toContain('dangerouslySetInnerHTML');
      expect(page, rel).not.toContain(['generate', 'OmStyle', 'Html'].join(''));
      expect(page, rel).not.toContain("@/lib/docPrint");
      expect(page, rel).not.toMatch(/(sales-order|quotation|purchase-bill|purchase-order)-print-area/);
    }

    for (const rel of DETAIL_PAGES.slice(0, 4)) {
      expect(read(rel), rel).toMatch(/printElementInIframe\(\s*'invoice-printable-area'/);
    }

    expect(read('pages/SalesInvoiceViewPage.tsx')).toContain('printInvoice');
    expect(read('lib/invoiceExport.tsx')).toMatch(/printElementInIframe\(\s*'invoice-printable-area'/);
  });

  it('list pages carry row-level print and pdf download actions', () => {
    for (const rel of LIST_PAGES) {
      const page = read(rel);
      expect(page, rel).toMatch(/\bPrinter\b/);
      expect(page, rel).toMatch(/\bDownload\b/);
      expect(page, rel).toMatch(/printDocument/);
      expect(page, rel).toMatch(/downloadDocumentPdf/);
    }
  });

  it('print stylesheet binds only the canonical id', () => {
    const css = read('index.css');
    expect(css).toContain('#invoice-printable-area');
    expect(css).not.toContain(['#invoice-', 'print-area'].join(''));
  });
});
