// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateReceiptHtml, printPaymentReceipt } from './receiptPrint';

describe('receiptPrint', () => {
  const business = {
    id: 'biz-1',
    name: 'Acme Traders',
    currency_symbol: '₹',
    address: '123 Market St',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    phone: '9876543210',
    email: 'acme@example.com',
    gstin: '27AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
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

  it('generates HTML containing receipt number, business details, customer info, and amount', () => {
    const html = generateReceiptHtml(payment, business);

    expect(html).toContain('RCP/26-27/1');
    expect(html).toContain('Acme Traders');
    expect(html).toContain('Sharma Industries');
    expect(html).toContain('UTR987654321');
    expect(html).toContain('Advance for upcoming order');
    expect(html).toContain('INV/26-27/101');
    expect(html).toContain('PAYMENT RECEIPT');
  });

  it('renders unapplied balance when amount exceeds allocated amount', () => {
    const html = generateReceiptHtml(payment, business);
    expect(html).toContain('Unallocated');
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
    expect(html).toContain('Receipt');
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

      // Fast-forward timeout to trigger iframe print
      vi.advanceTimersByTime(400);
      expect(mockPrint).toHaveBeenCalled();

      // Fast-forward timeout for cleanup
      vi.advanceTimersByTime(2000);

      vi.restoreAllMocks();
    });
  });
});
