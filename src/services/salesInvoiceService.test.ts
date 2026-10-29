import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSalesInvoiceItemRows, updateSalesInvoiceService } from './salesInvoiceService';

const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockInsert = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'sales_invoices') {
        return {
          update: (data: any) => {
            mockUpdate(data);
            return {
              eq: (col1: string, val1: any) => ({
                eq: (col2: string, val2: any) => ({
                  select: () => ({
                    single: () => Promise.resolve({ data: { id: val2, ...data }, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'sales_invoice_items') {
        return {
          delete: () => {
            mockDelete();
            return {
              eq: (col1: string, val1: any) => ({
                eq: (col2: string, val2: any) => Promise.resolve({ error: null }),
              }),
            };
          },
          insert: (rows: any[]) => {
            mockInsert(rows);
            return {
              select: () => Promise.resolve({ data: rows, error: null }),
            };
          },
        };
      }
      return {};
    },
  },
}));

describe('salesInvoiceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildSalesInvoiceItemRows assigns business_id to every item record', () => {
    const businessId = '14c1652a-9a48-441b-be9d-6c9da6e11a95';
    const invoiceId = '91bc33f9-70fd-40f8-96e7-867be4077a47';
    const rawItems = [
      {
        product_id: '663fc922-9e4a-4520-bf1d-08b45f43c054',
        product_name: 'PREMIERE KIT 620 WT',
        quantity: 2,
        rate: 80000,
        tax_rate: 0,
        total_amount: 160000,
      },
      {
        product_id: 'invalid-uuid',
        product_name: 'Custom Service',
        quantity: 1,
        rate: 500,
        total_amount: 500,
      },
    ];

    const rows = buildSalesInvoiceItemRows(businessId, invoiceId, rawItems);

    expect(rows).toHaveLength(2);
    expect(rows[0].business_id).toBe(businessId);
    expect(rows[0].invoice_id).toBe(invoiceId);
    expect(rows[0].product_id).toBe('663fc922-9e4a-4520-bf1d-08b45f43c054');

    expect(rows[1].business_id).toBe(businessId);
    expect(rows[1].invoice_id).toBe(invoiceId);
    // Invalid UUID sanitized to null to prevent foreign key errors
    expect(rows[1].product_id).toBeNull();
  });

  it('updateSalesInvoiceService executes header update, delete, and insert with business_id', async () => {
    const businessId = '14c1652a-9a48-441b-be9d-6c9da6e11a95';
    const invoiceId = '91bc33f9-70fd-40f8-96e7-867be4077a47';

    await updateSalesInvoiceService({
      businessId,
      invoiceId,
      invoiceData: { grand_total: 160000 },
      items: [
        {
          product_id: '663fc922-9e4a-4520-bf1d-08b45f43c054',
          product_name: 'PREMIERE KIT 620 WT',
          quantity: 2,
          rate: 80000,
          total_amount: 160000,
        },
      ],
    });

    expect(mockUpdate).toHaveBeenCalledWith({ grand_total: 160000 });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        business_id: businessId,
        invoice_id: invoiceId,
        product_name: 'PREMIERE KIT 620 WT',
        quantity: 2,
        rate: 80000,
      }),
    ]);
  });
});
