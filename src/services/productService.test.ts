import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkProductLinked,
  deleteProduct,
  archiveProduct,
  sanitizeProductUpdatePayload,
  updateProductService,
} from './productService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('productService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkProductLinked', () => {
    it('returns true when product is linked to sales invoice items', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sales_invoice_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [{ id: 'item-1' }], error: null }),
              }),
            }),
          };
        }
        if (table === 'purchase_bill_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const isLinked = await checkProductLinked('prod-123');
      expect(isLinked).toBe(true);
    });

    it('returns true when product is linked to purchase bill items', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sales_invoice_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'purchase_bill_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [{ id: 'bill-item-1' }], error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const isLinked = await checkProductLinked('prod-123');
      expect(isLinked).toBe(true);
    });

    it('returns false when product has no linked invoice or bill items', async () => {
      (supabase.from as any).mockImplementation(() => ({
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }));

      const isLinked = await checkProductLinked('prod-123');
      expect(isLinked).toBe(false);
    });
  });

  describe('deleteProduct', () => {
    it('throws warning when product is linked to existing transactions', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sales_invoice_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [{ id: 'item-1' }], error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      });

      await expect(deleteProduct('biz-1', 'prod-1')).rejects.toThrow(
        'Cannot delete product linked to existing invoices or bills. You can archive it instead.'
      );
    });

    it('deletes cleanly when product is not linked', async () => {
      let deletedTable = '';
      const eqCalls: Record<string, string> = {};

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sales_invoice_items' || table === 'purchase_bill_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'products') {
          deletedTable = table;
          const chain = {
            eq: (col: string, val: string) => {
              eqCalls[col] = val;
              return chain;
            },
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return {
            delete: () => chain,
          };
        }
        return {};
      });

      await expect(deleteProduct('biz-1', 'prod-1')).resolves.toBeUndefined();
      expect(deletedTable).toBe('products');
      expect(eqCalls.id).toBe('prod-1');
      expect(eqCalls.business_id).toBe('biz-1');
    });

    it('catches foreign key constraint error (23503) and throws friendly archive suggestion', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'sales_invoice_items' || table === 'purchase_bill_items') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === 'products') {
          const chain = {
            eq: () => chain,
            then: (resolve: any) =>
              resolve({
                data: null,
                error: {
                  code: '23503',
                  message: 'update or delete on table "products" violates foreign key constraint',
                },
              }),
          };
          return {
            delete: () => chain,
          };
        }
        return {};
      });

      await expect(deleteProduct('biz-1', 'prod-1')).rejects.toThrow(
        'Cannot delete product linked to existing invoices or bills. You can archive it instead.'
      );
    });
  });

  describe('archiveProduct', () => {
    it('sets is_active to false for the product and business', async () => {
      const updatePayload: any = {};
      const eqCalls: Record<string, string> = {};

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            update: (payload: any) => {
              Object.assign(updatePayload, payload);
              const chain = {
                eq: (col: string, val: string) => {
                  eqCalls[col] = val;
                  return chain;
                },
                then: (resolve: any) => resolve({ data: null, error: null }),
              };
              return chain;
            },
          };
        }
        return {};
      });

      await archiveProduct('biz-1', 'prod-1');
      expect(updatePayload.is_active).toBe(false);
      expect(eqCalls.id).toBe('prod-1');
      expect(eqCalls.business_id).toBe('biz-1');
    });
  });

  describe('sanitizeProductUpdatePayload', () => {
    it('sanitizes input and populates minimum_stock, min_stock, and reorder_level consistently', () => {
      const payload = sanitizeProductUpdatePayload({
        name: '  3KW SOLAR KIT (C/P)  ',
        type: 'product',
        unit: '  SET  ',
        sku: '  SOL-3KW  ',
        barcode: '  890123  ',
        hsn_sac: '  8541  ',
        tax_rate: '18',
        purchase_price: '120000',
        selling_price: '160000',
        minimum_stock: '2',
        description: '  High efficiency solar kit  ',
        category_id: 'cat-123',
        // non-updatable / non-existent fields that should be stripped
        opening_stock: '10',
        current_stock: '5',
        unknown_field: 'random',
      });

      expect(payload).toEqual({
        name: '3KW SOLAR KIT (C/P)',
        type: 'product',
        unit: 'SET',
        sku: 'SOL-3KW',
        barcode: '890123',
        hsn_sac: '8541',
        tax_rate: 18,
        purchase_price: 120000,
        selling_price: 160000,
        minimum_stock: 2,
        min_stock: 2,
        reorder_level: 2,
        description: 'High efficiency solar kit',
        category_id: 'cat-123',
      });
      expect((payload as any).opening_stock).toBeUndefined();
      expect((payload as any).current_stock).toBeUndefined();
      expect((payload as any).unknown_field).toBeUndefined();
    });

    it('falls back to min_stock or reorder_level if minimum_stock is absent', () => {
      const fromMinStock = sanitizeProductUpdatePayload({
        name: 'Solar Inverter',
        min_stock: 3,
      });
      expect(fromMinStock.minimum_stock).toBe(3);
      expect(fromMinStock.min_stock).toBe(3);
      expect(fromMinStock.reorder_level).toBe(3);

      const fromReorder = sanitizeProductUpdatePayload({
        name: 'Solar Panel',
        reorder_level: 5,
      });
      expect(fromReorder.minimum_stock).toBe(5);
      expect(fromReorder.min_stock).toBe(5);
      expect(fromReorder.reorder_level).toBe(5);
    });

    it('handles empty strings and nullish values gracefully', () => {
      const payload = sanitizeProductUpdatePayload({
        name: '',
        sku: '',
        barcode: '   ',
        hsn_sac: '',
        description: '  ',
        category_id: '',
      });

      expect(payload.name).toBe('');
      expect(payload.sku).toBeNull();
      expect(payload.barcode).toBeNull();
      expect(payload.hsn_sac).toBeNull();
      expect(payload.description).toBeNull();
      expect(payload.category_id).toBeNull();
      expect(payload.minimum_stock).toBe(0);
      expect(payload.min_stock).toBe(0);
      expect(payload.reorder_level).toBe(0);
    });
  });

  describe('updateProductService', () => {
    it('successfully calls supabase update with sanitized payload', async () => {
      let updatedTable = '';
      let passedPayload: any = null;
      const eqCalls: Record<string, string> = {};

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'products') {
          updatedTable = table;
          const chain = {
            eq: (col: string, val: string) => {
              eqCalls[col] = val;
              return chain;
            },
            then: (resolve: any) => resolve({ data: null, error: null }),
          };
          return {
            update: (payload: any) => {
              passedPayload = payload;
              return chain;
            },
          };
        }
        return {};
      });

      await updateProductService({
        businessId: 'biz-1',
        productId: 'prod-1',
        form: {
          name: '3KW SOLAR KIT (C/P)',
          minimum_stock: '1',
          purchase_price: '50000',
        },
      });

      expect(updatedTable).toBe('products');
      expect(eqCalls.business_id).toBe('biz-1');
      expect(eqCalls.id).toBe('prod-1');
      expect(passedPayload.name).toBe('3KW SOLAR KIT (C/P)');
      expect(passedPayload.minimum_stock).toBe(1);
      expect(passedPayload.min_stock).toBe(1);
      expect(passedPayload.reorder_level).toBe(1);
    });

    it('falls back by stripping min_stock/reorder_level if schema cache mismatch occurs', async () => {
      let attempt = 0;
      const payloadsAttempted: any[] = [];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            update: (payload: any) => {
              payloadsAttempted.push(payload);
              attempt++;
              const chain = {
                eq: () => chain,
                then: (resolve: any) => {
                  if (attempt === 1) {
                    return resolve({
                      data: null,
                      error: {
                        code: 'PGRST204',
                        message: "Could not find the 'min_stock' column of 'products' in the schema cache",
                      },
                    });
                  }
                  return resolve({ data: null, error: null });
                },
              };
              return chain;
            },
          };
        }
        return {};
      });

      await expect(
        updateProductService({
          businessId: 'biz-1',
          productId: 'prod-1',
          form: {
            name: '3KW SOLAR KIT (C/P)',
            minimum_stock: '1',
          },
        })
      ).resolves.toBeUndefined();

      expect(attempt).toBe(2);
      expect(payloadsAttempted[0].min_stock).toBe(1);
      expect(payloadsAttempted[1].min_stock).toBeUndefined();
      expect(payloadsAttempted[1].reorder_level).toBeUndefined();
      expect(payloadsAttempted[1].minimum_stock).toBe(1);
    });

    it('throws if unexpected database error occurs', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'products') {
          return {
            update: () => {
              const chain = {
                eq: () => chain,
                then: (resolve: any) =>
                  resolve({
                    data: null,
                    error: {
                      code: '42501',
                      message: 'permission denied for table products',
                    },
                  }),
              };
              return chain;
            },
          };
        }
        return {};
      });

      await expect(
        updateProductService({
          businessId: 'biz-1',
          productId: 'prod-1',
          form: {
            name: '3KW SOLAR KIT (C/P)',
            minimum_stock: '1',
          },
        })
      ).rejects.toThrow('permission denied for table products');
    });
  });
});
