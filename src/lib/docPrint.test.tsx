/**
 * PBS-186 — Directive-9 engine swap regression.
 *
 * The doc print engine is now UniversalDocumentTemplate-backed: the retired
 * raw-HTML generator is GONE, and the two engine entry
 * points (renderDocSheetToPdf / renderDocSheetToPdfBlob) mount the approved
 * GyftKart UDT (TAX INVOICE / RECEIPT pill, Billed To + Payment & Fulfillment
 * dual cards, 7-column items table, DIGITALLY AUTHORIZED block) offscreen and
 * print / capture from it. The pure kernel is mapPrintableDocToUniversalData,
 * so this file pins (a) the data mapping and (b) that the mapped data renders
 * through the approved contract.
 *
 * Directive-13 retired the old 6-row w-[58%] header geometry — the approved
 * layout is mode-invariant and always carries the canonical invoice pill.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  classifyDocumentType,
  mapPrintableDocToUniversalData as map,
  type PrintableDocData,
} from './docPrint';
import { UniversalDocumentTemplate } from '@/components/documents/UniversalDocumentTemplate';

const termsOf = (terms: string | string[] | null | undefined): string[] =>
  Array.isArray(terms) ? terms : terms ? [terms] : [];

const baseDoc: PrintableDocData = {
  docTitle: 'TAX INVOICE',
  docNumber: 'INV-0001',
  dateLabel: 'Date',
  dateValue: '01/01/2026',
  partyLabel: 'Customer',
  partyName: 'VERMA STEEL WORKS',
  partyAddress: "44, Gandhi Road\nKanpur, Uttar Pradesh - 208012",
  partyGstin: '09XXXXX9999A1Z5',
  partyPhone: '+91 90000 00000',
  status: 'confirmed',
  items: [],
  subtotal: 12500,
  taxableAmount: 12500,
  cgst: 1125,
  sgst: 1125,
  igst: 0,
  grandTotal: 14750,
} as unknown as PrintableDocData;

const business = {
  id: 'biz-1',
  legal_name: 'KRISHNAV AGRO PRIVATE LIMITED',
  name: 'Krishnav Agro',
  address: '14, Professional Colony',
  city: 'Aligarh',
  state: 'Uttar Pradesh',
  pincode: '205001',
  gstin: '09ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  cin: 'U29299UP2019PTC123456',
  email: 'support@krishnav.example',
  phone: '+91 91234 56789',
  logo_url: 'https://cdn.example/logo.png',
  bank_name: 'HDFC Bank',
  bank_account_name: 'KRISHNAV AGRO PVT LTD',
  bank_account_number: '50100012345678',
  bank_ifsc_code: 'HDFC0000123',
};

describe('docPrint engine — classification (PBS-186)', () => {
  it('maps the five doc titles to canonical UDT types', () => {
    expect(classifyDocumentType({ docTitle: 'PURCHASE BILL' })).toBe('PURCHASE_BILL');
    expect(classifyDocumentType({ docTitle: 'PURCHASE ORDER' })).toBe('PURCHASE_ORDER');
    expect(classifyDocumentType({ docTitle: 'SALES ORDER' })).toBe('SALES_ORDER');
    expect(classifyDocumentType({ docTitle: 'QUOTATION' })).toBe('QUOTATION');
    expect(classifyDocumentType({ docTitle: 'TAX INVOICE' })).toBe('TAX_INVOICE');
    expect(classifyDocumentType({ docTitle: 'QUOTE', isPurchaseBill: false })).toBe('QUOTATION');
    expect(classifyDocumentType({ docTitle: 'ESTIMATE' })).toBe('QUOTATION');
  });

  it('the isPurchaseBill flag routes an unlisted title to PURCHASE_BILL', () => {
    expect(classifyDocumentType({ docTitle: 'INWARD', isPurchaseBill: true })).toBe('PURCHASE_BILL');
    expect(classifyDocumentType({ docTitle: 'ORDER FORM', isPurchaseBill: false })).toBe('TAX_INVOICE');
  });

  it('QUOTATION does not lose its precedence to the QUOTE prefix semantics', () => {
    // 'QUOTA...' starts with QUOTE but contains QUOTATION — same branch either way.
    expect(classifyDocumentType({ docTitle: 'QUOTATION / ESTIMATE' })).toBe('QUOTATION');
  });
});

describe('docPrint engine — PrintableDocData → UniversalDocumentData', () => {
  it('tax invoice: seller = business (pan SIN derives), buyer = customer', () => {
    const d = map(business, baseDoc);
    expect(d.documentType).toBe('TAX_INVOICE');
    expect(d.documentNumber).toBe('INV-0001');
    expect(d.date).toBe('01/01/2026');
    expect(d.seller?.name).toBe('KRISHNAV AGRO PRIVATE LIMITED');
    expect(d.seller?.gstin).toBe('09ABCDE1234F1Z5');
    expect(d.seller?.cin).toBe('U29299UP2019PTC123456');
    expect(d.buyer.name).toBe('VERMA STEEL WORKS');
    expect(d.buyer.gstin).toBe('09XXXXX9999A1Z5');
    expect(d.buyer.pan).toBeUndefined();
    expect(d.paymentMode).toBe('Bank / UPI / Credit');
    expect(d.bankDetails?.bankName).toBe('HDFC Bank');
    expect(d.customer.name).toBe('VERMA STEEL WORKS');
    expect(d.totalAmount).toBe(14750);
  });

  it('purchase bill: Billed By supplier, Billed To our business, NO bank card, neutral terms', () => {
    const d = map(business, { ...baseDoc, docTitle: 'PURCHASE BILL', isPurchaseBill: true });
    expect(d.documentType).toBe('PURCHASE_BILL');
    expect(d.seller?.name).toBe('VERMA STEEL WORKS');
    expect(d.seller?.gstin).toBe('09XXXXX9999A1Z5');
    expect(d.seller?.cin).toBeUndefined();
    expect(d.buyer.name).toBe('KRISHNAV AGRO PRIVATE LIMITED');
    expect(d.customer.name).toBe('KRISHNAV AGRO PRIVATE LIMITED');
    expect(d.totalAmount).toBe(14750);
    expect(d.bankDetails).toBeUndefined();
    expect(d.paymentMode).toBeUndefined();
    expect(termsOf(d.terms).join(' ')).toContain('Goods received are subject to inspection');
    expect(termsOf(d.terms).join(' ')).not.toContain('drawn in favour');
  });

  it('purchase order shares the supplier/business role swap', () => {
    const d = map(business, { ...baseDoc, docTitle: 'PURCHASE ORDER', isPurchaseBill: true });
    expect(d.documentType).toBe('PURCHASE_ORDER');
    expect(d.seller?.name).toBe('VERMA STEEL WORKS');
    expect(d.buyer.name).toBe('KRISHNAV AGRO PRIVATE LIMITED');
    expect(d.customer.name).toBe('KRISHNAV AGRO PRIVATE LIMITED');
  });

  it('business PAN derives from GSTIN when not stored (no fake literal)', () => {
    const withoutPan = { ...business };
    delete (withoutPan as { pan?: string }).pan;
    delete (withoutPan as { cin?: string }).cin;
    const d = map(withoutPan, { ...baseDoc });
    expect(d.seller?.pan).toBe('ABCDE1234F');
    // CIN collapses to '' (cleanText) — falsy, so the sold header line omits it like the old engine.
    expect(d.seller?.cin).toBe('');
  });

  it('numeric + item mapping keeps the engine table contract', () => {
    const d = map(business, {
      ...baseDoc,
      items: [
        {
          product_name: '',
          hsn_sac: null,
          quantity: 125,
          unit: 'BOTTLE',
          rate: 350,
          tax_rate: 0,
          total_amount: 43750,
        },
      ],
    });
    expect(d.items[0].name).toBe('Custom item');
    expect(d.items[0].hsnSac).toBe('—');
    expect(d.items[0].quantity).toBe(125);
    expect(d.items[0].unit).toBe('BOTTLE');
    expect(d.items[0].rate).toBe(350);
    expect(d.items[0].total).toBe(43750);
    expect(d.subtotal).toBe(12500);
    expect(d.cgstAmount).toBe(1125);
    expect(d.sgstAmount).toBe(1125);
    expect(d.igstAmount).toBe(0);
    expect(d.grandTotal).toBe(14750);
  });

  it('amount in words keeps the engine verbiage (Rupees Only, Indian grouping)', () => {
    const d = map(business, { ...baseDoc, grandTotal: 180000 });
    expect(d.amountInWords).toBe('One Lakh Eighty Thousand Rupees Only');
  });

  it('expiry/time passthrough: absent expiry maps to undefined dueDate', () => {
    const withExpiry = map(business, {
      ...baseDoc,
      docTitle: 'SALES ORDER',
      expiryLabel: 'Expected Delivery',
      expiryValue: '2026-10-30',
      time: '01:25 PM',
    });
    expect(withExpiry.dueDate).toBe('30/10/2026');
    expect(withExpiry.time).toBe('01:25 PM');
    expect(withExpiry.documentType).toBe('SALES_ORDER');

    const without = map(business, { ...baseDoc, expiryValue: null, time: undefined });
    expect(without.dueDate).toBeUndefined();
    expect(without.time).toBeUndefined();
  });

  it('place of supply: party value wins, else the business state', () => {
    expect(map(business, { ...baseDoc, partyPlaceOfSupply: 'Delhi (07)' }).placeOfSupply).toBe('Delhi (07)');
    expect(map({ state: 'Uttar Pradesh' }, { ...baseDoc }).placeOfSupply).toBe('Uttar Pradesh');
  });

  it('party provide no name: purchase defaults Supplier, sales default Customer', () => {
    expect(map(business, { ...baseDoc, docTitle: 'PURCHASE BILL', isPurchaseBill: true, partyName: '' }).seller?.name).toBe('Supplier');
    expect(map(business, { ...baseDoc, partyName: '' }).buyer.name).toBe('Customer');
  });

  it('terms chain: record terms win, business tnc_* second, legacy engine defaults last', () => {
    expect(map(business, { ...baseDoc, terms: 'Custom record terms line.' }).terms).toEqual(['Custom record terms line.']);
    const withTnc = map(
      { ...business, tnc_purchase: 'Saved purchase defaults line one.\nSaved purchase defaults line two.' },
      { ...baseDoc, docTitle: 'PURCHASE BILL', isPurchaseBill: true }
    );
    expect(termsOf(withTnc.terms)).toEqual(['Saved purchase defaults line one.', 'Saved purchase defaults line two.']);
    const legacy = map({ ...business, tnc_invoice: undefined }, { ...baseDoc });
    expect(termsOf(legacy.terms)[0]).toBe('Goods once sold will not be taken back or exchanged.');
    expect(termsOf(legacy.terms).join(' ')).toContain('All payments to be drawn in favour of "KRISHNAV AGRO PRIVATE LIMITED".');
    expect(termsOf(legacy.terms).pop()).toContain('computer-generated document');
  });
});

describe('docPrint engine — engine output is the approved GyftKart UDT (directive-13)', () => {
  const docTypes = ['TAX INVOICE', 'QUOTATION', 'SALES ORDER', 'PURCHASE ORDER', 'PURCHASE BILL'];

  const renderOf = (doc: PrintableDocData) =>
    renderToStaticMarkup(
      <UniversalDocumentTemplate data={map(business, doc)} />
    );

  it.each(docTypes)('%s renders the approved GyftKart invoice layout', (docTitle) => {
    const html = renderOf({ ...baseDoc, docTitle, isPurchaseBill: docTitle === 'PURCHASE BILL' });
    // Header pill + dual party / payment cards
    expect(html).toContain(docTitle === 'TAX INVOICE' ? 'TAX INVOICE / RECEIPT' : docTitle);
    expect(html).toContain('Billed To');
    expect(html).toContain('Payment &amp; Fulfillment');
    // 7-column items table
    expect(html).toContain('Item Description / Voucher');
    expect(html).toContain('HSN/SAC');
    expect(html).toContain('>Qty<');
    expect(html).toContain('Unit Rate (₹)');
    expect(html).toContain('Tax (GST)');
    expect(html).toContain('Total (₹)');
    // Statutory footer blocks
    expect(html).toContain('Amount Chargeable (in words)');
    expect(html).toContain('Authorized Signatory');
  });

  it('the approved layout carries Place of Supply and no Supply Type line', () => {
    for (const docTitle of docTypes) {
      const html = renderOf({ ...baseDoc, docTitle, isPurchaseBill: docTitle === 'PURCHASE BILL' });
      expect(html).toContain('Place of Supply');
      expect(html).not.toContain('Supply Type');
    }
  });
});
