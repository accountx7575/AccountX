import { describe, it, expect, vi } from 'vitest';
import {
  resolveUniversalDocumentFromPayload,
  getDocumentViewPath,
  printDocument,
  type DocumentActionType,
} from './documentActions';

const mockBusiness = {
  id: 'biz-1',
  name: 'Acme Corp',
  legal_name: 'Acme Corporation Ltd',
  city: 'Barabanki',
  state: 'Uttar Pradesh',
  pincode: '225001',
  gstin: '09AAACA1234A1Z5',
};

describe('documentActions - resolveUniversalDocumentFromPayload', () => {
  it('correctly maps a quotation payload to UniversalDocumentData', () => {
    const quote = {
      id: 'q-1',
      quotation_number: 'QT-2026-001',
      quote_date: '2026-10-27',
      customer: {
        name: 'Ayan',
        city: 'Barabanki',
        state: 'Uttar Pradesh',
        pincode: '225001',
      },
      grand_total: 5000,
    };
    const items = [
      { product_name: 'Item 1', quantity: 2, rate: 2500, total_amount: 5000 },
    ];

    const result = resolveUniversalDocumentFromPayload(
      'quotation',
      quote,
      items,
      mockBusiness
    );

    expect(result.filename).toBe('QT-2026-001.pdf');
    expect(result.title).toBe('Quotation QT-2026-001');
    expect(result.data.documentType).toBe('QUOTATION');
    expect(result.data.documentNumber).toBe('QT-2026-001');
    expect(result.data.customer?.name).toBe('Ayan');
  });

  it('correctly maps a sales order payload to UniversalDocumentData', () => {
    const order = {
      id: 'so-1',
      order_number: 'SO-2026-001',
      order_date: '2026-10-27',
      customer: {
        name: 'John Doe',
        city: 'Lucknow',
        state: 'Uttar Pradesh',
      },
      grand_total: 10000,
    };
    const items = [
      { product_name: 'Widget A', quantity: 10, unit_price: 1000, totalPrice: 10000 },
    ];

    const result = resolveUniversalDocumentFromPayload(
      'sales_order',
      order,
      items,
      mockBusiness
    );

    expect(result.filename).toBe('SO-2026-001.pdf');
    expect(result.title).toBe('Sales Order SO-2026-001');
    expect(result.data.documentType).toBe('SALES_ORDER');
    expect(result.data.documentNumber).toBe('SO-2026-001');
  });

  it('correctly maps a sales invoice payload to UniversalDocumentData', () => {
    const invoice = {
      id: 'inv-1',
      invoice_number: 'INV-2026-001',
      invoice_date: '2026-10-27',
      customer: {
        name: 'Alice',
      },
      grand_total: 15000,
    };
    const items = [
      { product_name: 'Service 1', quantity: 1, rate: 15000, total_amount: 15000 },
    ];

    const result = resolveUniversalDocumentFromPayload(
      'sales_invoice',
      invoice,
      items,
      mockBusiness
    );

    expect(result.filename).toBe('INV-2026-001.pdf');
    expect(result.title).toBe('Tax Invoice INV-2026-001');
    expect(result.data.documentType).toBe('TAX_INVOICE');
    expect(result.data.documentNumber).toBe('INV-2026-001');
  });

  it('correctly maps purchase order and purchase bill payloads', () => {
    const po = {
      id: 'po-1',
      order_number: 'PO-2026-001',
      order_date: '2026-10-27',
      supplier: { name: 'Supplier Corp' },
    };
    const poResult = resolveUniversalDocumentFromPayload(
      'purchase_order',
      po,
      [],
      mockBusiness
    );
    expect(poResult.filename).toBe('PO-2026-001.pdf');
    expect(poResult.title).toBe('Purchase Order PO-2026-001');
    expect(poResult.data.documentType).toBe('PURCHASE_ORDER');

    const bill = {
      id: 'bill-1',
      bill_number: 'BILL-2026-001',
      bill_date: '2026-10-27',
      supplier: { name: 'Supplier Corp' },
    };
    const billResult = resolveUniversalDocumentFromPayload(
      'purchase_bill',
      bill,
      [],
      mockBusiness
    );
    expect(billResult.filename).toBe('BILL-2026-001.pdf');
    expect(billResult.title).toBe('Purchase Bill BILL-2026-001');
    expect(billResult.data.documentType).toBe('PURCHASE_BILL');
  });

  it('generates canonical detail view paths for all document types', () => {
    expect(getDocumentViewPath('quotation', 'q-123')).toBe('/app/quotations/q-123');
    expect(getDocumentViewPath('sales_order', 'so-123')).toBe('/app/sales-orders/so-123');
    expect(getDocumentViewPath('sales_invoice', 'inv-123')).toBe('/app/sales-invoices/inv-123');
    expect(getDocumentViewPath('purchase_order', 'po-123')).toBe('/app/purchase-orders/po-123');
    expect(getDocumentViewPath('purchase_bill', 'pb-123')).toBe('/app/purchase-bills/pb-123');
  });

  it('printDocument routes directly to detail view with action=print when navigate is passed', async () => {
    const navigateMock = vi.fn();
    await printDocument('sales_order', 'so-999', mockBusiness, navigateMock);
    expect(navigateMock).toHaveBeenCalledWith('/app/sales-orders/so-999?action=print');
  });
});
