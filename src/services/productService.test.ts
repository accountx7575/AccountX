import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkProductLinked, deleteProduct, archiveProduct } from './productService';
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
});
