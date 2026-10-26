import { createRoot } from 'react-dom/client';
import {
  UniversalDocumentTemplate,
  printElementInIframe,
  getDocumentTitles,
  type DocumentType,
  type PartyDetails,
  type UniversalDocumentData,
} from '@/components/documents/UniversalDocumentTemplate';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import { cleanMedia, cleanText } from '@/lib/nullable';
import { formatAddress2Line } from '@/lib/utils';
import { resolveTermsLines, tncLines, type TncDocType } from '@/lib/tncDefaults';

export interface PrintableDocData {
  docTitle: string;
  docNumber: string;
  dateLabel: string;
  dateValue: string;
  // PBS-171 — 12-hour clock label of the document creation time (e.g. '01:25 PM'); printed only when present.
  time?: string;
  expiryLabel?: string;
  expiryValue?: string | null;
  ewayBillNo?: string | null;
  vehicleNo?: string | null;
  partyLabel: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPhone?: string;
  partyPlaceOfSupply?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToPhone?: string;
  shipToPlaceOfSupply?: string;
  status: string;
  items: Array<{
    product_name: string;
    hsn_sac?: string | null;
    quantity: number;
    unit?: string;
    rate: number;
    tax_rate: number;
    taxable_amount?: number;
    total_amount: number;
  }>;
  subtotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff?: number;
  grandTotal: number;
  notes?: string | null;
  terms?: string | null;
  /** Demo/Proforma sandbox: 'estimate' | 'demo' | 'clean' — undefined keeps real docs byte-identical. */
  demoHeader?: 'estimate' | 'demo' | 'clean';
  /** Purchase-bill mode: Billed By = supplier, Billed To = our business,
   *  no bank card, neutral terms, no signature image/For-block. */
  isPurchaseBill?: boolean;
}

function numberToWordsINR(num: number): string {
  const a = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const b = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  const inWords = (n: number): string => {
    let str = '';
    if (n > 99) {
      str += `${a[Math.floor(n / 100)]} Hundred `;
      n %= 100;
    }
    if (n > 19) {
      str += `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ''} `;
    } else if (n > 0) {
      str += `${a[n]} `;
    }
    return str;
  };

  const rounded = Math.round(Number(num || 0));
  if (rounded === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  let out = '';
  if (crore) out += `${inWords(crore)}Crore `;
  if (lakh) out += `${inWords(lakh)}Lakh `;
  if (thousand) out += `${inWords(thousand)}Thousand `;
  if (hundred) out += inWords(hundred);

  return `${out.trim()} Rupees Only`;
}

/** ISO date strings → DD/MM/YYYY; anything else passes through untouched
 *  (the retired engine applied the same coercion at print time). */
function toDMY(value: string | null | undefined): string | undefined {
  const v = String(value ?? '');
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
    : v;
}

/**
 * PBS-186 — docTitle/isPurchaseBill → the canonical UDT DocumentType.
 * Same classification semantics as the retired raw-HTML generator:
 * purchase titles first, then sales order, then quotation family
 * ('QUOTATION' is NOT a substring of 'QUOTE' — includes + startsWith both
 * required), then the isPurchaseBill flag, else tax invoice.
 */
export function classifyDocumentType(doc: {
  docTitle: string;
  isPurchaseBill?: boolean;
}): DocumentType {
  const t = String(doc.docTitle || '').toUpperCase();
  if (t.includes('PURCHASE BILL')) return 'PURCHASE_BILL';
  if (t.includes('PURCHASE ORDER')) return 'PURCHASE_ORDER';
  if (t.includes('SALES ORDER')) return 'SALES_ORDER';
  if (t.includes('QUOTATION') || t.startsWith('QUOTE') || t.includes('ESTIMATE'))
    return 'QUOTATION';
  if (doc.isPurchaseBill === true) return 'PURCHASE_BILL';
  return 'TAX_INVOICE';
}

/** I-frame/browser title of the printed document (old engine's <title> shape,
 *  including the demo/estimate header overrides). */
function pageTitleFor(
  documentType: DocumentType,
  demoHeader?: PrintableDocData['demoHeader'],
  docNumber = ''
): string {
  let header = getDocumentTitles(documentType).header;
  if (demoHeader === 'estimate') header = 'ESTIMATE / PROFORMA INVOICE';
  else if (demoHeader === 'demo') header = `DEMO ${header.split(' / ')[0]}`;
  return docNumber ? `${docNumber} - ${header}` : header;
}

/** Business record → the seller/buyer party shape UDT's own adapters fill
 *  (PBS-118 blank-over-fake retained: no hardcoded dev-business literals). */
function businessParty(business: any): PartyDetails {
  const businessName = business?.legal_name || business?.name || '';
  const gstin = cleanText(business?.gstin);
  // PAN stays DERIVED strictly from GSTIN when not stored — no fake literal.
  const pan =
    cleanText(business?.pan) ||
    (String(gstin).length >= 12 ? String(gstin).slice(2, 12) : '');
  return {
    name: businessName,
    companyName: businessName,
    address: cleanText(business?.address),
    city: cleanText(business?.city),
    state: cleanText(business?.state),
    pincode: cleanText(business?.pincode),
    gstin,
    pan,
    cin: cleanText(business?.cin),
    website: cleanText(business?.website),
    email: cleanText(business?.email),
    phone: cleanText(business?.phone),
    logoUrl: cleanMedia(business?.logo_url),
  };
}

/**
 * PBS-186 — the doc kernel: PrintableDocData → UniversalDocumentData.
 * Pure function. Party roles keep the old engine's exact semantics
 * (purchase docs: Billed By = supplier / Billed To = our business, no bank
 * card, neutral terms; sales docs: Billed By = our business / Billed To =
 * the customer), demoHeader passes through for the PBS-112 sandbox, and the
 * terms chain (record terms > business tnc_* > legacy built-ins) resolves
 * via the SAME tncDefaults helpers the old engine used.
 */
export function mapPrintableDocToUniversalData(
  business: any,
  doc: PrintableDocData,
): UniversalDocumentData {
  const documentType = classifyDocumentType(doc);
  const isPurchaseBill = documentType === 'PURCHASE_BILL';
  const isPurchase = documentType === 'PURCHASE_ORDER' || isPurchaseBill;

  const biz = businessParty(business);
  const supplierParty: PartyDetails = {
    name: doc.partyName || 'Supplier',
    address: cleanText(doc.partyAddress),
    gstin: cleanText(doc.partyGstin),
    phone: cleanText(doc.partyPhone),
  };
  const customerParty: PartyDetails = {
    name: doc.partyName || 'Customer',
    address: cleanText(doc.partyAddress),
    gstin: cleanText(doc.partyGstin),
    phone: cleanText(doc.partyPhone),
  };

  const tncDocType: TncDocType = isPurchase
    ? 'purchase'
    : documentType === 'QUOTATION'
      ? 'quotation'
      : documentType === 'SALES_ORDER'
        ? 'sales_order'
        : 'sales_invoice';

  // Record terms win; empty falls back to business defaults (db > localStorage);
  // nothing configured keeps the built-in legacy terms.
  const resolvedTncLines = resolveTermsLines(tncDocType, business, doc.terms);
  const legacyTncLines = tncLines(
    isPurchase
      ? `Goods received are subject to inspection and acceptance as per the purchase order.
Please quote this bill number in all future correspondence.
This is a computer-generated document and requires no physical signature.`
      : `Goods once sold will not be taken back or exchanged.
${biz.name ? `All payments to be drawn in favour of "${biz.name}".` : ''}
Redemption / delivery is subject to agreed operational timelines.
This is a computer-generated document and requires no physical signature.`
  );
  const terms = resolvedTncLines.length ? resolvedTncLines : legacyTncLines;

  return {
    documentType,
    documentNumber: String(doc.docNumber ?? ''),
    date: toDMY(doc.dateValue) || String(doc.dateValue ?? ''),
    time: doc.time || undefined,
    dueDate: toDMY(doc.expiryValue),
    placeOfSupply:
      doc.partyPlaceOfSupply || biz.state || undefined,
    seller: isPurchase ? supplierParty : biz,
    buyer: isPurchase ? biz : customerParty,
    // Approved UDT interface (directive-13): `customer` is required; purchase
    // docs bill our business, sales docs bill the customer (same role as buyer).
    customer: isPurchase ? biz : customerParty,
    items: doc.items.map((item) => ({
      name: item.product_name || 'Custom item',
      hsnSac: item.hsn_sac || '—',
      quantity: Number(item.quantity ?? 1),
      unit: item.unit || '',
      rate: Number(item.rate || 0),
      taxRate: Number(item.tax_rate || 0),
      total: Number(item.total_amount || 0),
    })),
    subtotal: Number(doc.subtotal || 0),
    cgstAmount: Number(doc.cgst || 0),
    sgstAmount: Number(doc.sgst || 0),
    igstAmount: Number(doc.igst || 0),
    roundOff: doc.roundOff,
    totalAmount: Number(doc.grandTotal || 0),
    grandTotal: Number(doc.grandTotal || 0),
    // Old engine → UDT word source: keep the docPrint verbiage exactly.
    amountInWords: numberToWordsINR(doc.grandTotal),
    // Purchase docs carry no bank card (old engine omitted it there).
    bankDetails: isPurchase
      ? undefined
      : {
          bankName: cleanText((business as any)?.bank_name),
          accountName:
            cleanText((business as any)?.bank_account_name) ||
            cleanText((business as any)?.account_name) ||
            biz.name,
          accountNumber: cleanText((business as any)?.bank_account_number),
          ifsc: cleanText((business as any)?.bank_ifsc_code),
        },
    paymentMode: isPurchase ? undefined : 'Bank / UPI / Credit',
    demoHeader: doc.demoHeader ?? undefined,
    terms,
    notes: doc.notes || undefined,
  };
}

const MOUNT_WIDTH = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;';

/**
 * PBS-186 — DOC ENGINE (Directive-9): print channel.
 * Mounts the certified UniversalDocumentTemplate offscreen with the mapped
 * data (the proven hidden-mount pattern used by the invoice PDF export)
 * and hands the committed element to the isolated-iframe print helper.
 * The old raw-HTML generator path is GONE — the header comes from
 * the UDT's certified 6-row width-capped layout.
 */
export async function renderDocSheetToPdf(
  business: any,
  doc: PrintableDocData,
): Promise<void> {
  const data = mapPrintableDocToUniversalData(business, doc);
  const host = document.createElement('div');
  host.style.cssText = MOUNT_WIDTH;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<UniversalDocumentTemplate data={data} />);
    // Allow the React commit + logo/QR paint before serializing to the iframe.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const element = (host.firstElementChild as HTMLElement) ?? host;
    printElementInIframe(
      element,
      pageTitleFor(data.documentType, data.demoHeader ?? undefined, doc.docNumber)
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

/**
 * PBS-186 — DOC ENGINE (Directive-9): PDF blob channel (download/e-mail).
 * Same hidden UDT mount, captured to a PDF blob via the shared A4 tiling
 * capture helper. Signature and Blob-return contract unchanged for callers.
 */
export async function renderDocSheetToPdfBlob(
  business: any,
  doc: PrintableDocData,
): Promise<Blob> {
  const data = mapPrintableDocToUniversalData(business, doc);
  const host = document.createElement('div');
  host.id = 'accountx-pdf-capture-host';
  host.style.cssText = MOUNT_WIDTH;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<UniversalDocumentTemplate data={data} />);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const images = Array.from(host.querySelectorAll('img'));
    if (images.length > 0) {
      await Promise.all(
        images.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const target = (host.firstElementChild as HTMLElement) ?? host;
    return await captureElementToPdfBlob(target);
  } finally {
    root.unmount();
    host.remove();
  }
}
