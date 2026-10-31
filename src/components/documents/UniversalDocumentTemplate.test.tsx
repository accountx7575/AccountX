import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UniversalDocumentTemplate,
  getDocumentTitles,
  inrDecimal,
  numberToWordsINR,
  formatPlaceOfSupply,
  mapQuotationToUniversalData,
  mapSalesOrderToUniversalData,
  mapPurchaseBillToUniversalData,
  type DocumentType,
  type UniversalDocumentData,
} from './UniversalDocumentTemplate';

const TYPES: DocumentType[] = [
  'TAX_INVOICE',
  'SALES_ORDER',
  'QUOTATION',
  'PURCHASE_ORDER',
  'PURCHASE_BILL',
];

function baseData(overrides: Partial<UniversalDocumentData> = {}): UniversalDocumentData {
  return {
    documentType: 'TAX_INVOICE',
    documentNumber: 'INV/26-27/42',
    date: '21/10/2026',
    paymentMethod: 'UPI',
    paymentStatus: 'PAID',
    orderNumber: 'ORD-1001',
    paymentRef: 'UTR-778899',
    company: {
      name: 'GyftKart',
      legalName: 'GyftKart Private Limited',
      addressLine1: 'H.NO.AN/25, Lautabagh',
      city: 'Barabanki',
      state: 'Uttar Pradesh',
      pincode: '225001',
      gstin: '09AAHCT1158J1Z2',
      pan: 'AAHCT1158',
      cin: 'U74999UP2019PTC112218',
      email: 'support@gyftkart.in',
      website: 'www.gyftkart.in',
    },
    customer: {
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      phone: '+91 90000 00000',
      billingAddress: '12 MG Road',
      billingCity: 'Lucknow',
      billingState: 'Uttar Pradesh',
      billingPincode: '226001',
      customerType: 'B2C',
    },
    items: [
      {
        id: '1',
        name: 'Amazon Gift Voucher',
        hsnSac: '998434',
        quantity: 2,
        rate: 500,
        taxRate: 0,
        total: 1000,
      },
    ],
    subtotal: 1000,
    tax: 0,
    totalAmount: 1000,
    ...overrides,
  };
}

const render = (data: UniversalDocumentData, props: { id?: string; className?: string } = {}) =>
  renderToStaticMarkup(<UniversalDocumentTemplate data={data} {...props} />);

const headersOf = (html: string) =>
  (html.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || []).map((cell) =>
    cell.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  );

const bodyRows = (html: string): string[] => {
  const body = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return body.match(/<tr[\s\S]*?<\/tr>/g) || [];
};

describe('UniversalDocumentTemplate - approved GyftKart layout (directive-13)', () => {
  it('renders the TAX INVOICE / RECEIPT pill for invoice documents', () => {
    const html = render(baseData());
    expect(html).toContain('TAX INVOICE / RECEIPT');
    expect(html).toContain('Original for Recipient');
  });

  it('renders dynamic document badge per document type', () => {
    for (const documentType of TYPES) {
      const html = render(baseData({ documentType }));
      if (documentType === 'QUOTATION') {
        expect(html, documentType).toContain('QUOTATION');
        expect(html, documentType).not.toContain('TAX INVOICE / RECEIPT');
      } else if (documentType === 'SALES_ORDER') {
        expect(html, documentType).toContain('SALES ORDER');
        expect(html, documentType).not.toContain('TAX INVOICE / RECEIPT');
      } else if (documentType === 'PURCHASE_ORDER') {
        expect(html, documentType).toContain('PURCHASE ORDER');
        expect(html, documentType).not.toContain('TAX INVOICE / RECEIPT');
      } else if (documentType === 'PURCHASE_BILL') {
        expect(html, documentType).toContain('PURCHASE BILL');
        expect(html, documentType).not.toContain('TAX INVOICE / RECEIPT');
      } else {
        expect(html, documentType).toContain('TAX INVOICE / RECEIPT');
      }
    }
    expect(getDocumentTitles('QUOTATION').title).toBe('QUOTATION');
    expect(getDocumentTitles('SALES_ORDER').title).toBe('SALES ORDER');
    expect(getDocumentTitles('PURCHASE_ORDER').title).toBe('PURCHASE ORDER');
    expect(getDocumentTitles('PURCHASE_BILL').title).toBe('PURCHASE BILL');
    expect(getDocumentTitles('TAX_INVOICE').title).toBe('TAX INVOICE / RECEIPT');
  });

  it('marks B2B recipients on the pill subtitle', () => {
    const html = render(
      baseData({
        customer: {
          name: 'Neha Sharma',
          companyName: 'Verma Steel Works',
          gstin: '09XXXXX9999A1Z5',
          customerType: 'B2B',
        },
      })
    );
    expect(html).toContain('Original for Recipient (B2B Tax Invoice)');
  });

  it('marks B2C recipients on the pill subtitle', () => {
    const html = render(baseData());
    expect(html).toContain('Original for Recipient (B2C)');
  });

  it('renders the seller identity block with GSTIN, PAN, CIN and website when provided', () => {
    const html = render(baseData());
    expect(html).toContain('GyftKart Private Limited');
    expect(html).toContain('09AAHCT1158J1Z2');
    expect(html).toContain('AAHCT1158');
    expect(html).toContain('CIN:');
    expect(html).toContain('U74999UP2019PTC112218');
    expect(html).toContain('support@gyftkart.in');
    expect(html).toContain('Web:');
    expect(html).toContain('www.gyftkart.in');
  });

  it('omits the CIN and website lines when they are missing or blank', () => {
    for (const blank of [undefined, '', '   ']) {
      const html = render(
        baseData({
          company: {
            name: 'GyftKart',
            legalName: 'GyftKart Private Limited',
            gstin: '09AAHCT1158J1Z2',
            pan: 'AAHCT1158',
            email: 'support@gyftkart.in',
            cin: blank,
            website: blank,
          },
        })
      );
      expect(html, String(blank)).not.toContain('CIN:');
      expect(html, String(blank)).not.toContain('Web:');
      expect(html, String(blank)).not.toContain(' | ');
    }
  });

  it('labels the meta date row per document type', () => {
    const quotation = render(baseData({ documentType: 'QUOTATION', expiryDate: '2026-11-30' }));
    expect(quotation).toContain('Valid Until:');
    expect(quotation).toContain('30/11/2026');

    const salesOrder = render(baseData({ documentType: 'SALES_ORDER', expectedDeliveryDate: '2026-10-30' }));
    expect(salesOrder).toContain('Expected Delivery:');
    expect(salesOrder).toContain('30/10/2026');

    const invoice = render(baseData({ documentType: 'TAX_INVOICE', dueDate: '2026-12-15' }));
    expect(invoice).toContain('Due Date:');
    expect(invoice).toContain('15/12/2026');

    expect(render(baseData())).toContain('Place of Supply:');
    expect(render(baseData())).toContain('Uttar Pradesh (09)');
    expect(render(baseData())).not.toContain('Supply Type');
  });

  it('renders exact invoice_time alongside invoice_date matching form field', () => {
    const html = render(
      baseData({
        date: '2026-10-26',
        invoice_time: '04:32 pm',
      })
    );
    expect(html).toContain('Date &amp; Time:');
    expect(html).toContain('26/10/2026, 04:32 pm');
    expect(html).not.toContain('05:30 am');
  });

  it('renders 24-hour time property cleanly in 12-hour am/pm format', () => {
    const html = render(
      baseData({
        date: '2026-10-26',
        time: '16:32',
      })
    );
    expect(html).toContain('26/10/2026, 04:32 pm');
  });

  it('falls back to created_at timestamp when explicit time string is omitted', () => {
    const html = render(
      baseData({
        date: '2026-10-26',
        created_at: '2026-10-26T11:02:00.000Z',
      })
    );
    expect(html).toContain('26/10/2026, 04:32 pm');
  });

  it('renders clean date only when dateVal is date-only and no time is provided', () => {
    const html = render(
      baseData({
        date: '2026-10-26',
      })
    );
    expect(html).toContain('26/10/2026');
    expect(html).not.toContain('05:30 am');
  });

  it('formats Place of Supply with 2-digit Indian GST State Code dynamically', () => {
    expect(formatPlaceOfSupply('Uttar Pradesh')).toBe('Uttar Pradesh (09)');
    expect(formatPlaceOfSupply('Uttar Pradesh (09)')).toBe('Uttar Pradesh (09)');
    expect(formatPlaceOfSupply('Delhi')).toBe('Delhi (07)');
    expect(formatPlaceOfSupply('Maharashtra')).toBe('Maharashtra (27)');
    expect(formatPlaceOfSupply('Gujarat')).toBe('Gujarat (24)');
    expect(formatPlaceOfSupply('Karnataka')).toBe('Karnataka (29)');
    expect(formatPlaceOfSupply('09 - Uttar Pradesh')).toBe('Uttar Pradesh (09)');
    expect(formatPlaceOfSupply('27')).toBe('Maharashtra (27)');
    expect(formatPlaceOfSupply('', 'Tamil Nadu')).toBe('Tamil Nadu (33)');
    expect(formatPlaceOfSupply(undefined)).toBe('Uttar Pradesh (09)');

    const customDoc = render(baseData({ placeOfSupply: 'Delhi' }));
    expect(customDoc).toContain('Place of Supply:');
    expect(customDoc).toContain('Delhi (07)');

    const maharashtraDoc = render(baseData({ placeOfSupply: 'Maharashtra' }));
    expect(maharashtraDoc).toContain('Maharashtra (27)');
  });

  it('renders the Billed To card with the B2B corporate label', () => {
    const html = render(
      baseData({
        customer: {
          name: 'Neha Sharma',
          companyName: 'Verma Steel Works',
          gstin: '09XXXXX9999A1Z5',
          customerType: 'B2B',
        },
      })
    );
    expect(html).toMatch(/Billed To \(/);
    expect(html).toContain('Corporate Client');
    expect(html).toContain('M/s Verma Steel Works');
    expect(html).toContain('GSTIN: 09XXXXX9999A1Z5');
    expect(html).toContain('Attn:');
    expect(html).toContain('Neha Sharma');
  });

  it('renders the Billed To card with the B2C customer label and contact fields', () => {
    const html = render(baseData());
    expect(html).toContain('Customer Details');
    expect(html).toContain('Ravi Kumar');
    expect(html).toContain('ravi@example.com');
    expect(html).toContain('+91 90000 00000');
    expect(html).toContain('12 MG Road');
  });

  it('renders the Payment & Fulfillment card with order, mode and UTR', () => {
    const html = render(baseData());
    expect(html).toContain('Payment &amp; Fulfillment');
    expect(html).toContain('Order Ref:');
    expect(html).toContain('#ORD-1001');
    expect(html).toContain('Payment Mode:');
    expect(html).toContain('UPI');
    expect(html).toContain('Ref / UTR No:');
    expect(html).toContain('UTR-778899');
  });

  it('shows the paid state for confirmed statuses', () => {
    for (const paymentStatus of ['PAID', 'SUCCESS', 'CONFIRMED', 'DELIVERED']) {
      expect(render(baseData({ paymentStatus })), paymentStatus).toContain('PAID &amp; DELIVERED');
    }
  });

  it('shows the raw status when unpaid', () => {
    const html = render(baseData({ paymentStatus: 'pending' }));
    expect(html).toContain('PENDING');
    expect(html).not.toContain('PAID &amp; DELIVERED');
  });

  it('renders exactly the seven approved item headers in order', () => {
    const headers = headersOf(render(baseData()));
    expect(headers).toEqual([
      '#',
      'Item Description / Voucher',
      'HSN/SAC',
      'Qty',
      'Unit Rate (₹)',
      'Tax (GST)',
      'Total (₹)',
    ]);
  });

  it('renders one row per item with qty, rate, tax and total', () => {
    const html = render(
      baseData({
        items: [
          { id: 'a', name: 'Amazon Gift Voucher', hsnSac: '998434', quantity: 2, rate: 500, taxRate: 0, total: 1000 },
          { id: 'b', name: 'Flipkart Gift Voucher', hsnSac: '998435', quantity: 3, rate: 250, taxRate: 18, total: 885 },
        ],
        subtotal: 1750,
        tax: 90,
        totalAmount: 1840,
      })
    );
    const rows = bodyRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Amazon Gift Voucher');
    expect(rows[0]).toContain('998434');
    expect(rows[0]).toContain('2');
    expect(rows[0]).toContain('500.00');
    expect(rows[0]).toContain('0.00%');
    expect(rows[0]).toContain('1,000.00');
    expect(rows[1]).toContain('Flipkart Gift Voucher');
    expect(rows[1]).toContain('18.00%');
    expect(rows[1]).toContain('885.00');
  });

  it('applies the approved item fallbacks and computes the row total', () => {
    const html = render(
      baseData({
        items: [{ quantity: 4, denomination: 125 }],
        subtotal: 500,
        tax: 0,
        totalAmount: 500,
      })
    );
    expect(html).toContain('GyftKart Digital Gift Voucher');
    expect(html).toContain('998434');
    expect(html).toContain('125.00');
    expect(html).toContain('500.00');
  });

  it('renders delivery email and voucher code extras', () => {
    const html = render(
      baseData({
        items: [
          {
            name: 'Amazon Gift Voucher',
            quantity: 1,
            rate: 1000,
            recipientEmail: 'gift@example.com',
            code: 'AMZ-1234',
          },
        ],
        subtotal: 1000,
        totalAmount: 1000,
      })
    );
    expect(html).toContain('Delivered to: gift@example.com');
    expect(html).toContain('Code: AMZ-1234');
  });

  it('prints the amount in words from the grand total', () => {
    const html = render(baseData({ subtotal: 1000, tax: 90, totalAmount: 1090 }));
    expect(html).toContain('Amount Chargeable (in words)');
    expect(html).toContain(numberToWordsINR(1090));
    expect(html).toContain('One Thousand Ninety Rupees Only');
  });

  it('converts rupee amounts to Indian words', () => {
    expect(numberToWordsINR(0)).toBe('Zero Rupees Only');
    expect(numberToWordsINR(1000)).toBe('One Thousand Rupees Only');
    expect(numberToWordsINR(100000)).toBe('One Lakh Rupees Only');
    expect(numberToWordsINR(10000000)).toBe('One Crore Rupees Only');
    expect(numberToWordsINR(1234)).toBe('One Thousand Two Hundred Thirty Four Rupees Only');
  });

  it('splits intra-state tax into CGST and SGST', () => {
    const html = render(baseData({ subtotal: 1000, tax: 90, totalAmount: 1090 }));
    expect(html).toContain('Subtotal (Taxable Value):');
    expect(html).toMatch(/CGST [\d.]+%/);
    expect(html).toMatch(/SGST [\d.]+%/);
    expect(html).toContain('₹45.00');
    expect(html).not.toContain('IGST');
  });

  it('renders a single IGST line for inter-state supply', () => {
    const html = render(
      baseData({ subtotal: 1000, tax: 90, igst: 90, totalAmount: 1090 })
    );
    expect(html).toMatch(/IGST [\d.]+%/);
    expect(html).toContain('₹90.00');
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('SGST');
  });

  it('renders the grand total with Indian number formatting', () => {
    const html = render(baseData({ subtotal: 1000, tax: 90, totalAmount: 1090 }));
    expect(html).toContain('Grand Total (INR):');
    expect(html).toContain('₹1,090.00');
    expect(inrDecimal(1090)).toBe('1,090.00');
    expect(inrDecimal(1234567.5)).toBe('12,34,567.50');
  });

  it('renders a discount line when a discount is present', () => {
    const html = render(baseData({ subtotal: 1000, totalAmount: 950, discount: 50 }));
    expect(html).toContain('Discount:');
    expect(html).toContain('- ₹50.00');
  });

  it('renders Round Off row with formatted value when round_off or roundOff is provided', () => {
    // Negative round off (-₹0.05)
    const htmlNeg = render(baseData({ subtotal: 152381, tax: 7619.05, round_off: -0.05, totalAmount: 160000 }));
    expect(htmlNeg).toContain('Round Off:');
    expect(htmlNeg).toContain('-₹0.05');
    expect(htmlNeg).toContain('Grand Total (INR):');
    expect(htmlNeg).toContain('₹1,60,000.00');

    // Sequence verification: Subtotal -> CGST -> SGST -> Round Off -> Grand Total
    const subIdx = htmlNeg.indexOf('Subtotal (Taxable Value):');
    const cgstIdx = htmlNeg.indexOf('Central GST');
    const sgstIdx = htmlNeg.indexOf('State GST');
    const roundIdx = htmlNeg.indexOf('Round Off:');
    const grandIdx = htmlNeg.indexOf('Grand Total (INR):');
    expect(subIdx).toBeGreaterThan(-1);
    expect(cgstIdx).toBeGreaterThan(subIdx);
    expect(sgstIdx).toBeGreaterThan(cgstIdx);
    expect(roundIdx).toBeGreaterThan(sgstIdx);
    expect(grandIdx).toBeGreaterThan(roundIdx);

    // Positive round off (+₹0.48)
    const htmlPos = render(baseData({ subtotal: 1000, tax: 180, roundOff: 0.48, totalAmount: 1180.48 }));
    expect(htmlPos).toContain('Round Off:');
    expect(htmlPos).toContain('+₹0.48');

    // Omits when 0
    const htmlZero = render(baseData({ subtotal: 1000, tax: 180, round_off: 0, totalAmount: 1180 }));
    expect(htmlZero).not.toContain('Round Off:');

    // Dynamic on-the-fly rounding when document has unrounded grand_total (160000.05)
    const htmlUnroundedQuote = render(baseData({
      documentType: 'QUOTATION',
      documentNumber: 'QT/ABC/SE/26-27/1',
      subtotal: 152381,
      tax: 7619.05,
      totalAmount: 160000.05,
    }));
    expect(htmlUnroundedQuote).toContain('Round Off:');
    expect(htmlUnroundedQuote).toContain('-₹0.05');
    expect(htmlUnroundedQuote).toContain('Grand Total (INR):');
    expect(htmlUnroundedQuote).toContain('₹1,60,000.00');
    expect(htmlUnroundedQuote).not.toContain('₹1,60,000.05');

    // Dynamic on-the-fly rounding for Sales Order SO/ABC/SE/26-27/1
    const htmlUnroundedOrder = render(baseData({
      documentType: 'SALES_ORDER',
      documentNumber: 'SO/ABC/SE/26-27/1',
      subtotal: 152381,
      tax: 7619.05,
      totalAmount: 160000.05,
    }));
    expect(htmlUnroundedOrder).toContain('Round Off:');
    expect(htmlUnroundedOrder).toContain('-₹0.05');
    expect(htmlUnroundedOrder).toContain('Grand Total (INR):');
    expect(htmlUnroundedOrder).toContain('₹1,60,000.00');
    expect(htmlUnroundedOrder).not.toContain('₹1,60,000.05');
  });

  it('renders the authorized signatory block', () => {
    const html = render(baseData());
    expect(html).toContain('Authorized Signatory');
    expect(html).toContain('For GyftKart');
  });

  it('renders dynamic stamp and signature image when provided', () => {
    const html = render(
      baseData({
        company: {
          name: 'GyftKart',
          signatureUrl: 'https://example.com/stamp.png',
          signatureName: 'Abdul Qari - Proprietor',
        },
      })
    );
    expect(html).toContain('src="https://example.com/stamp.png"');
    expect(html).toContain('Abdul Qari - Proprietor');
  });

  it('renders the standard terms and conditions or dynamic terms', () => {
    const html = render(baseData());
    expect(html).toContain('Terms &amp; Conditions:');
    expect(html).toContain('Standard terms &amp; conditions apply.');

    const customHtml = render(
      baseData({
        terms: 'Prices valid for 15 days.\nPayment in advance.',
      })
    );
    expect(customHtml).toContain('Prices valid for 15 days.');
    expect(customHtml).toContain('Payment in advance.');
  });

  it('aligns Terms & Conditions and Signature block with items-start and equal mt-0 metrics', () => {
    const html = render(baseData());
    expect(html).toContain('items-start gap-6 pt-6');
    expect(html).toContain('Terms &amp; Conditions:');
    expect(html).toContain('For GyftKart');
    expect(html).not.toContain('items-end gap-6 pt-6');
  });

  it('renders invoice footer text as a centered bottom bar when present', () => {
    const withoutFooter = render(baseData());
    expect(withoutFooter).not.toContain('border-t border-slate-100 pt-2 pb-1 mt-6 text-center');

    const withFooter = render(baseData({ invoiceFooterText: 'ye digital invoice hai' }));
    expect(withFooter).toContain('ye digital invoice hai');
    expect(withFooter).toContain('border-t border-slate-100 pt-2 pb-1 mt-6 text-center');
  });

  it('renders bank details cleanly as a single column list', () => {
    const html = render(
      baseData({
        bankDetails: {
          bankName: 'HDFC Bank',
          accountHolderName: 'Avadh Boring Company',
          accountNumber: '50200012345678',
          ifsc: 'HDFC0001234',
          upiId: 'avadh@upi',
        },
      })
    );
    expect(html).toContain('Bank &amp; Payment Details');
    expect(html).toContain('flex flex-col space-y-0.5');
    expect(html).toContain('Bank:');
    expect(html).toContain('HDFC Bank');
    expect(html).toContain('A/C Name:');
    expect(html).toContain('Avadh Boring Company');
    expect(html).toContain('A/C No:');
    expect(html).toContain('50200012345678');
    expect(html).toContain('IFSC:');
    expect(html).toContain('HDFC0001234');
    expect(html).toContain('UPI:');
    expect(html).toContain('avadh@upi');
  });

  it('prefers a provided tax note over the default voucher note', () => {
    const html = render(baseData({ taxNote: 'Custom GST treatment applies.' }));
    expect(html).toContain('Custom GST treatment applies.');
    expect(html).not.toContain('actionable claims');
  });

  it('defaults the wrapper id to invoice-printable-area and accepts an override', () => {
    expect(render(baseData())).toContain('id="invoice-printable-area"');
    expect(render(baseData(), { id: 'custom-doc' })).toContain('id="custom-doc"');
  });

  it('merges the provided className onto the printable wrapper', () => {
    expect(render(baseData(), { className: 'shadow-sm' })).toContain('shadow-sm');
  });

  it('renders no watermark in any demo mode (approved layout has none)', () => {
    for (const demoHeader of ['clean', 'estimate', 'demo'] as const) {
      const html = render(baseData({ demoHeader }));
      expect(html.toLowerCase(), demoHeader).not.toContain('watermark');
      expect(html.toLowerCase(), demoHeader).not.toContain('sample');
    }
  });

  it('renders purchase variants through the same approved layout', () => {
    for (const documentType of ['PURCHASE_ORDER', 'PURCHASE_BILL'] as DocumentType[]) {
      const html = render(baseData({ documentType, isPurchaseBill: true }));
      expect(html, documentType).toContain(documentType === 'PURCHASE_ORDER' ? 'PURCHASE ORDER' : 'PURCHASE BILL');
      expect(headersOf(html), documentType).toHaveLength(7);
      expect(html, documentType).toContain('Authorized Signatory');
    }
  });

  it('renders customer address with street and City, State - PIN matching header structure', () => {
    const html = render(
      baseData({
        customer: {
          name: 'Ayan',
          address: '123 Business Street\nBarabanki, Uttar Pradesh - 225001',
        },
      })
    );
    expect(html).toContain('Ayan');
    expect(html).toContain('123 Business Street');
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
  });

  it('mapQuotationToUniversalData constructs clean customer address lines', () => {
    const quote = {
      quotation_number: 'QT-2026-001',
      customer: {
        name: 'Ayan',
        address: '123 Business Street',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
      },
    };
    const mapped = mapQuotationToUniversalData({}, quote);
    expect(mapped.customer.name).toBe('Ayan');
    expect(mapped.customer.address).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
    const html = render(mapped);
    expect(html).toContain('123 Business Street');
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
  });

  it('mapSalesOrderToUniversalData constructs clean customer address lines', () => {
    const order = {
      order_number: 'SO-2026-001',
      customer: {
        name: 'Ayan',
        address: '123 Business Street',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
      },
    };
    const mapped = mapSalesOrderToUniversalData({}, order);
    expect(mapped.customer.name).toBe('Ayan');
    expect(mapped.customer.address).toBe('123 Business Street\nBarabanki, Uttar Pradesh - 225001');
    const html = render(mapped);
    expect(html).toContain('123 Business Street');
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
  });

  it('renders city/state/pin fallback exactly once when customer address is empty', () => {
    const html = render(
      baseData({
        customer: {
          name: 'Ayan',
          address: '',
          city: 'Barabanki',
          state: 'Uttar Pradesh',
          pincode: '225001',
        },
      })
    );
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
  });

  it('renders uploaded business logo image when company.logo_url is present', () => {
    const htmlWithLogo = render(
      baseData({
        company: {
          name: 'Avadh Boring Company',
          logo_url: 'https://example.com/logo.png',
        },
      })
    );
    expect(htmlWithLogo).toContain('<img src="https://example.com/logo.png"');
    expect(htmlWithLogo).toContain('alt="Avadh Boring Company"');
    expect(htmlWithLogo).toContain('class="h-12 w-auto object-contain max-w-[180px]"');
  });

  it('renders green circular badge with letter fallback when company logo is absent', () => {
    const htmlWithoutLogo = render(
      baseData({
        company: {
          name: 'Avadh Boring Company',
          logo_url: undefined,
        },
      })
    );
    expect(htmlWithoutLogo).not.toContain('class="h-12 w-auto object-contain max-w-[180px]"');
    expect(htmlWithoutLogo).toContain('rounded-full bg-emerald-600 text-white');
    expect(htmlWithoutLogo).toContain('A');
  });

  it('renders header supplier/company contact in single row (Phone | Email) with stacked address', () => {
    const html = render(
      baseData({
        documentType: 'PURCHASE_BILL',
        company: {
          name: 'Supreme Pipes Ltd',
          addressLine1: 'Plot 44, Industrial Area Phase 2',
          city: 'Kanpur',
          state: 'Uttar Pradesh',
          pincode: '208001',
          gstin: '09AABCS1234F1Z5',
          pan: 'AABCS1234F',
          phone: '+91 9450942418',
          email: 'sales@supremepipes.com',
        },
      })
    );
    expect(html).toContain('Plot 44, Industrial Area Phase 2');
    expect(html).toContain('Kanpur, Uttar Pradesh - 208001');
    expect(html).toContain('GSTIN:');
    expect(html).toContain('09AABCS1234F1Z5');
    expect(html).toContain('PAN:');
    expect(html).toContain('AABCS1234F');
    expect(html).toContain('Phone:');
    expect(html).toContain('+91 9450942418');
    expect(html).toContain('Email:');
    expect(html).toContain('sales@supremepipes.com');
  });

  it('renders Billed To party card with stacked address hierarchy and inline contact row', () => {
    const html = render(
      baseData({
        customer: {
          name: 'Avadh Boring Company',
          companyName: 'Avadh Boring Company',
          address: 'AN-25, Lautabagh, Azadnagar, Nawabganj\nBarabanki, Uttar Pradesh - 225001',
          gstin: '09AABPQ3096M1Z5',
          pan: 'AABPQ3096M',
          phone: '+91 9450942418',
          email: 'abc.solar7575@gmail.com',
        },
      })
    );
    expect(html).toContain('Avadh Boring Company');
    expect(html).toContain('AN-25, Lautabagh, Azadnagar, Nawabganj');
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
    expect(html).toContain('GSTIN: 09AABPQ3096M1Z5');
    expect(html).toContain('PAN: AABPQ3096M');
    expect(html).toContain('Phone:');
    expect(html).toContain('+91 9450942418');
    expect(html).toContain('Email:');
    expect(html).toContain('abc.solar7575@gmail.com');
  });

  it('mapPurchaseBillToUniversalData constructs clean stacked buyer and supplier addresses with inline contact info', () => {
    const business = {
      name: 'Avadh Boring Company',
      address: 'AN-25, Lautabagh, Azadnagar, Nawabganj',
      city: 'Barabanki',
      state: 'Uttar Pradesh',
      pincode: '225001',
      gstin: '09AABPQ3096M1Z5',
      pan: 'AABPQ3096M',
      phone: '+91 9450942418',
      email: 'abc.solar7575@gmail.com',
    };
    const bill = {
      bill_number: 'PB/2026/001',
      supplier: {
        name: 'Supreme Pipes Ltd',
        address: 'Plot 44, Industrial Area Phase 2',
        city: 'Kanpur',
        state: 'Uttar Pradesh',
        pincode: '208001',
        gstin: '09AABCS1234F1Z5',
        phone: '+91 9876543210',
        email: 'billing@supremepipes.com',
      },
    };
    const mapped = mapPurchaseBillToUniversalData(business, bill);
    expect(mapped.company?.name).toBe('Supreme Pipes Ltd');
    expect(mapped.company?.phone).toBe('+91 9876543210');
    expect(mapped.company?.email).toBe('billing@supremepipes.com');
    expect(mapped.customer?.name).toBe('Avadh Boring Company');
    expect(mapped.customer?.phone).toBe('+91 9450942418');
    expect(mapped.customer?.email).toBe('abc.solar7575@gmail.com');

    const html = render(mapped);
    expect(html).toContain('Supreme Pipes Ltd');
    expect(html).toContain('Plot 44, Industrial Area Phase 2');
    expect(html).toContain('Kanpur, Uttar Pradesh - 208001');
    expect(html).toContain('billing@supremepipes.com');
    expect(html).toContain('+91 9876543210');
    expect(html).toContain('AN-25, Lautabagh, Azadnagar, Nawabganj');
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
    expect(html).toContain('abc.solar7575@gmail.com');
    expect(html).toContain('+91 9450942418');
  });
});
