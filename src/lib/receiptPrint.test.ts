// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateReceiptHtml, printPaymentReceipt, RECEIPT_STYLES } from './receiptPrint';

describe('receiptPrint', () => {
  const business = {
    id: 'biz-1',
    name: 'Avadh Boring Company',
    currency_symbol: '₹',
    address: '123 Market St',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    phone: '9876543210',
    email: 'contact@avadhboring.com',
    gstin: '27AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    bank_name: 'HDFC Bank',
    bank_account_no: '50100123456789',
    bank_ifsc: 'HDFC0001234',
    account_name: 'Avadh Boring Company',
    upi_id: 'avadh@hdfcbank',
  };

  const payment = {
    id: 'pay-123',
    payment_number: 'RCP/26-27/1',
    date: '2026-10-28',
    amount: 20000,
    allocated_amount: 15000,
    payment_method: 'bank',
    reference: 'UTR987654321',
    notes: 'Advance for upcoming order',
    customer: {
      name: 'Sharma Industries',
      email: 'sharma@example.com',
      phone: '9123456780',
      address: 'Plot 4, MIDC, Pune',
      gstin: '27BBBBB0000B1Z6',
    },
    invoice: {
      invoice_number: 'INV/26-27/101',
    },
  };

  it('generates HTML matching the exact Sales Order / UDT standard layout', () => {
    const html = generateReceiptHtml(payment, business);

    // 1. Header: business branding with logo letter, business name, address, GSTIN, and receipt badge
    expect(html).toContain('Avadh Boring Company');
    expect(html).toContain('RCP/26-27/1');
    expect(html).toContain('PAYMENT RECEIPT');
    expect(html).toContain('Original for Recipient');
    expect(html).toContain('27AAAAA0000A1Z5');
    expect(html).toContain('contact@avadhboring.com');

    // 2. Two-Column Info Cards
    expect(html).toContain('RECEIVED FROM');
    expect(html).toContain('Sharma Industries');
    expect(html).toContain('27BBBBB0000B1Z6');
    expect(html).toContain('PAYMENT DETAILS');
    expect(html).toContain('UTR987654321');
    expect(html).toContain('RECEIVED');

    // 3. Particulars Table with standard Sales Order columns
    expect(html).toContain('DESCRIPTION / INVOICE REF');
    expect(html).toContain('ORIGINAL AMOUNT');
    expect(html).toContain('ALLOCATED AMOUNT');
    expect(html).toContain('UNALLOCATED / BALANCE');
    expect(html).toContain('INV/26-27/101');
    expect(html).toContain('Advance for upcoming order');

    // 4. Summary & Bank Details Section
    expect(html).toContain('AMOUNT IN WORDS');
    expect(html).toContain('BANK &amp; PAYMENT DETAILS');
    expect(html).toContain('HDFC Bank');
    expect(html).toContain('50100123456789');
    expect(html).toContain('HDFC0001234');
    expect(html).toContain('Total Received (INR)');

    // 5. Footer & Signatory Block
    expect(html).toContain('FOR AVADH BORING COMPANY');
    expect(html).toContain('Authorized Signatory');
    expect(html).toContain('All payments are subject to realization of cheque / electronic transfer.');
    expect(html).toContain('Any discrepancy must be reported to the accounts department within 7 days.');
    expect(html).toContain('This is a computer-generated receipt.');
  });

  it('renders unapplied balance when amount exceeds allocated amount', () => {
    const html = generateReceiptHtml(payment, business);
    expect(html).toContain('Unallocated / Balance');
  });

  it('renders Round Off row when payment has round_off or roundOff', () => {
    const paymentWithRoundOff = {
      ...payment,
      round_off: -0.05,
    };
    const html = generateReceiptHtml(paymentWithRoundOff, business);
    expect(html).toContain('Round Off:');
    expect(html).toContain('-₹0.05');

    const paymentWithPosRoundOff = {
      ...payment,
      roundOff: 0.48,
    };
    const htmlPos = generateReceiptHtml(paymentWithPosRoundOff, business);
    expect(htmlPos).toContain('Round Off:');
    expect(htmlPos).toContain('+₹0.48');
  });

  it('formats top-right metadata block into clean single lines with Receipt Date & Time in 12-hour format', () => {
    const paymentWithTimestamp = {
      ...payment,
      payment_number: 'PR/ABC/SE/26-27/1',
      date: '2026-10-28',
      created_at: '2026-10-28T19:37:00',
      payment_method: 'cash',
    };

    const html = generateReceiptHtml(paymentWithTimestamp, business);

    // Single-line rows matching Sales Order standard
    expect(html).toContain('<span class="label">Receipt No:</span>');
    expect(html).toContain('<strong>PR/ABC/SE/26-27/1</strong>');
    expect(html).toContain('<span class="label">Receipt Date &amp; Time:</span>');
    expect(html).toContain('28/10/2026, 07:37 PM');
    expect(html).toContain('<span class="label">Payment Mode:</span>');
    expect(html).toContain('<span class="val">CASH</span>');
  });

  it('uses payment_date and time over created_at for Receipt Date & Time when payment is edited', () => {
    const editedPayment = {
      ...payment,
      payment_number: 'PR/ABC/SE/26-27/1',
      date: '2026-10-20',
      payment_date: '2026-10-20',
      time: '06:08 PM',
      created_at: '2026-10-28T12:38:12.736Z',
      payment_method: 'cash',
    };

    const html = generateReceiptHtml(editedPayment, business);
    expect(html).toContain('<span class="label">Receipt Date &amp; Time:</span>');
    expect(html).toContain('20/10/2026, 06:08 PM');
    expect(html).not.toContain('28/10/2026, 06:08 PM');
  });

  it('formats customer address card into 5 lines with street, city, state, pincode, and tax pills including Aadhaar', () => {
    const paymentWithFullCust = {
      ...payment,
      customer: {
        name: 'M/s Ramesh Chandra & Sons',
        phone: '9876543210',
        email: 'ramesh@example.com',
        address: 'Salarpur Ali, Fateh Ganj Barabanki, Nawabganj',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
        gstin: '09AAACR1234F1Z9',
        pan: 'AAACR1234F',
        aadhaar: '123456789012',
      },
    };

    const html = generateReceiptHtml(paymentWithFullCust, business);

    // Line 1: Name (Bold)
    expect(html).toContain('M/s Ramesh Chandra &amp; Sons');
    // Line 2: Phone | Email
    expect(html).toContain('9876543210');
    expect(html).toContain('ramesh@example.com');
    // Line 3: Street Address
    expect(html).toContain('Salarpur Ali, Fateh Ganj Barabanki, Nawabganj');
    // Line 4: City, State - Pincode
    expect(html).toContain('Barabanki, Uttar Pradesh - 225001');
    // Line 5: GSTIN / PAN / Aadhaar single-row key-value pairs
    expect(html).toContain('09AAACR1234F1Z9');
    expect(html).toContain('AAACR1234F');
    expect(html).toContain('1234-5678-9012');
    expect(html).toContain('<span class="label">PAN:</span>');
    expect(html).toContain('<span class="label">Aadhaar:</span>');

    // Verify static label prefixes (Phone:, Email:, Address:) are removed from the customer card
    const custCardHtml = html.split('customer-card-col')[1].split('payment-details-col')[0];
    expect(custCardHtml).not.toContain('>Phone:</span>');
    expect(custCardHtml).not.toContain('>Email:</span>');
    expect(custCardHtml).not.toContain('>Address:</span>');
  });

  it('only prints non-empty rows in RECEIVED FROM customer card', () => {
    const minimalCustPayment = {
      ...payment,
      customer: {
        name: 'Shanno',
        phone: '9935955378',
        email: 'usmanis474@gmail.com',
      },
    };

    const html = generateReceiptHtml(minimalCustPayment, business);
    const custCardHtml = html.split('customer-card-col')[1].split('payment-details-col')[0];

    // Non-empty rows are rendered
    expect(custCardHtml).toContain('Shanno');
    expect(custCardHtml).toContain('9935955378');
    expect(custCardHtml).toContain('usmanis474@gmail.com');

    // Missing rows (Address, City/State/Pin, GSTIN/PAN/Aadhaar) are NOT rendered as dummy/empty dashes
    expect(custCardHtml).not.toContain('—');
    expect(custCardHtml).not.toContain('>PAN:</span>');
    expect(custCardHtml).not.toContain('>Aadhaar:</span>');
  });

  it('formats BANK & PAYMENT DETAILS into clean single rows with exact key-value labels', () => {
    const html = generateReceiptHtml(payment, {
      ...business,
      bank_name: 'Canara Bank',
      account_name: 'Avadh Boring Company',
      bank_account_no: '120034396413',
      bank_ifsc: 'CNRB0018631',
    });

    expect(html).toContain('<span class="label">Bank:</span>');
    expect(html).toContain('<span class="val">Canara Bank</span>');
    expect(html).toContain('<span class="label">A/C Name:</span>');
    expect(html).toContain('<span class="val">Avadh Boring Company</span>');
    expect(html).toContain('<span class="label">A/C No:</span>');
    expect(html).toContain('<span class="val-mono">120034396413</span>');
    expect(html).toContain('<span class="label">IFSC:</span>');
    expect(html).toContain('<span class="val-mono">CNRB0018631</span>');
  });

  it('handles empty customer and business gracefully', () => {
    const minimalPayment = {
      id: 'pay-min',
      payment_number: 'RCP/MIN/1',
      date: '2026-10-28',
      amount: 500,
      payment_method: 'cash',
    };

    const html = generateReceiptHtml(minimalPayment, null);
    expect(html).toContain('RCP/MIN/1');
    expect(html).toContain('PAYMENT RECEIPT');
    expect(html).toContain('Total Received (INR)');
  });

  it('aligns Header and Customer/Payment Details into clean single-row grid layouts with consistent typography', () => {
    const html = generateReceiptHtml(payment, business);

    // 1. Header Single-Row Pairs
    expect(html).toContain('class="header-rows"');
    expect(html).toContain('123 Market St');
    expect(html).toContain('<span class="label">Receipt No:</span>');
    expect(html).toContain('<strong>RCP/26-27/1</strong>');
    expect(html).toContain('Mumbai, Maharashtra - 400001');
    expect(html).toContain('<span class="label">Receipt Date &amp; Time:</span>');
    expect(html).toContain('<span class="label">Payment Mode:</span>');

    // 2. Two-Column Cards
    expect(html).toContain('customer-card-col');
    expect(html).toContain('payment-details-col');
    expect(html).toContain('<span class="card-party-name">Sharma Industries</span>');
    expect(html).toContain('<span class="label">Payment Date:</span>');
    expect(html).toContain('<span class="label">Ref / Instrument No:</span>');
    expect(html).toContain('<span class="label">Payment Method:</span>');
    expect(html).toContain('<span class="label">Payment Status:</span>');
    expect(html).toContain('✓ RECEIVED');
  });

  it('applies tight line spacing to header rows and unbolds customer card lines except customer name', () => {
    // 1. Header rows tight gap
    expect(RECEIPT_STYLES).toContain('.header-rows {');
    expect(RECEIPT_STYLES).toContain('gap: 2px;');

    // 2. Customer card unbolding rules (only card-party-name remains bold)
    expect(RECEIPT_STYLES).toContain('.customer-card-col .card-party-name {');
    expect(RECEIPT_STYLES).toContain('font-weight: 700 !important;');
    expect(RECEIPT_STYLES).toContain('.customer-card-col .val,');
    expect(RECEIPT_STYLES).toContain('font-weight: 400 !important;');
  });

  it('renders business logo image when logo_url is provided on business', () => {
    const htmlWithLogo = generateReceiptHtml(payment, {
      ...business,
      logo_url: 'https://example.com/logo.png',
    });
    expect(htmlWithLogo).toContain('<img src="https://example.com/logo.png"');
    expect(htmlWithLogo).toContain('class="biz-logo-img"');
  });

  it('renders custom terms & conditions configured on business settings', () => {
    const customBusiness = {
      ...business,
      terms_payment_receipt: 'Custom Term 1: Payment valid upon realization.\nCustom Term 2: Non-refundable fee applies.',
    };

    const html = generateReceiptHtml(payment, customBusiness);
    expect(html).toContain('Custom Term 1: Payment valid upon realization.');
    expect(html).toContain('Custom Term 2: Non-refundable fee applies.');
    // Should NOT contain default terms when custom terms are provided
    expect(html).not.toContain('Any discrepancy must be reported to the accounts department within 7 days.');
  });

  it('allows document-level terms override on payment object', () => {
    const paymentWithCustomTerms = {
      ...payment,
      terms: 'Special receipt condition negotiated with customer.',
    };

    const html = generateReceiptHtml(paymentWithCustomTerms, business);
    expect(html).toContain('Special receipt condition negotiated with customer.');
  });

  describe('printPaymentReceipt', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('creates an iframe, writes receipt HTML, and triggers print', () => {
      const mockPrint = vi.fn();
      const mockClose = vi.fn();
      const mockWrite = vi.fn();

      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName.toLowerCase() === 'iframe') {
          Object.defineProperty(el, 'contentWindow', {
            value: {
              document: {
                open: vi.fn(),
                write: mockWrite,
                close: mockClose,
              },
              focus: vi.fn(),
              print: mockPrint,
            },
            writable: true,
          });
        }
        return el;
      });

      printPaymentReceipt(payment, business);

      expect(mockWrite).toHaveBeenCalled();
      const writtenHtml = mockWrite.mock.calls[0][0];
      expect(writtenHtml).toContain('RCP/26-27/1');
      expect(writtenHtml).toContain('Total Received (INR)');

      // Fast-forward timeout to trigger iframe print
      vi.advanceTimersByTime(400);
      expect(mockPrint).toHaveBeenCalledTimes(1);

      // Fast-forward timeout for cleanup
      vi.advanceTimersByTime(2000);

      vi.restoreAllMocks();
    });

    it('scopes global html and body styles strictly within @media print to avoid layout shrinkage', () => {
      // Must not leak font-size or un-scoped styles to host application document
      expect(RECEIPT_STYLES).toContain('@media print');
      expect(RECEIPT_STYLES).toContain('.receipt-container');

      // Ensure html, body is only defined inside @media print block
      const beforePrint = RECEIPT_STYLES.split('@media print')[0];
      expect(beforePrint).not.toContain('html, body');
    });
  });
});
