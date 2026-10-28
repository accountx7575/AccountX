import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sanitizeUuid,
  sanitizePurchaseBillPayload,
  sanitizePurchaseBillItemPayload,
  createPurchaseBillService,
  createPurchaseBillDirectly,
} from './purchaseBillService';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => {
  const insertMock = vi.fn();
  const selectMock = vi.fn();
  const singleMock = vi.fn();
  const rpcMock = vi.fn();

  return {
    supabase: {
      from: vi.fn((table: string) => {
        const builder: any = {
          insert: (payload: any) => {
            insertMock(table, payload);
            return {
              select: (cols?: string) => ({
                single: () => {
                  if (table === 'purchase_bills') {
                    return Promise.resolve({
                      data: {
                        id: 'bill-fallback-123',
                        bill_number: payload.bill_number || 'PB/26-27/001',
                        supplier_id: payload.supplier_id,
                        grand_total: payload.grand_total,
                        status: payload.status,
                      },
                      error: null,
                    });
                  }
                  return Promise.resolve({ data: null, error: null });
                },
              }),
            };
          },
          select: (cols?: string) => builder,
          eq: () => builder,
          in: () => builder,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          update: () => builder,
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return builder;
      }),
      rpc: (...args: any[]) => rpcMock(...args),
      _mocks: { insertMock, selectMock, singleMock, rpcMock },
    },
  };
});

describe('purchaseBillService sanitization', () => {
  it('sanitizes UUIDs and returns null for placeholders and invalid values', () => {
    expect(sanitizeUuid('_none_')).toBeNull();
    expect(sanitizeUuid('__none__')).toBeNull();
    expect(sanitizeUuid('none')).toBeNull();
    expect(sanitizeUuid('')).toBeNull();
    expect(sanitizeUuid('   ')).toBeNull();
    expect(sanitizeUuid(null)).toBeNull();
    expect(sanitizeUuid(undefined)).toBeNull();
    expect(sanitizeUuid('null')).toBeNull();
    expect(sanitizeUuid('undefined')).toBeNull();
    expect(sanitizeUuid('not-a-valid-uuid')).toBeNull();

    const validUuid = '14c1652a-9a48-441b-be9d-6c9da6e11a95';
    expect(sanitizeUuid(validUuid)).toBe(validUuid);
    expect(sanitizeUuid(`  ${validUuid}  `)).toBe(validUuid);
  });

  it('sanitizes purchase bill header payload foreign keys and dates', () => {
    const rawPayload = {
      supplier_id: '14c1652a-9a48-441b-be9d-6c9da6e11a95',
      bank_account_id: '_none_',
      warehouse_id: 'none',
      payment_account_id: '',
      due_date: '   ',
      notes: 'Test note',
      payment_method: '_none_',
      subtotal: 1000,
      grand_total: 1180,
    };

    const clean = sanitizePurchaseBillPayload(rawPayload);

    expect(clean.supplier_id).toBe('14c1652a-9a48-441b-be9d-6c9da6e11a95');
    expect(clean.bank_account_id).toBeNull();
    expect(clean.warehouse_id).toBeNull();
    expect(clean.payment_account_id).toBeNull();
    expect(clean.due_date).toBeNull();
    expect(clean.payment_method).toBeNull();
    expect(clean.notes).toBe('Test note');
    expect(clean.grand_total).toBe(1180);
  });

  it('preserves valid due_date when provided', () => {
    const clean = sanitizePurchaseBillPayload({
      due_date: '2026-11-15',
    });
    expect(clean.due_date).toBe('2026-11-15');
  });

  it('sanitizes line item product_id correctly', () => {
    const itemWithNone = {
      product_id: '_none_',
      product_name: 'Custom Boring Service',
      quantity: 1,
      rate: 500,
    };
    expect(sanitizePurchaseBillItemPayload(itemWithNone)).toEqual({
      product_id: null,
      product_name: 'Custom Boring Service',
      quantity: 1,
      rate: 500,
    });

    const itemWithValid = {
      product_id: '14c1652a-9a48-441b-be9d-6c9da6e11a95',
      product_name: 'Submersible Pump',
      quantity: 2,
      rate: 15000,
    };
    expect(sanitizePurchaseBillItemPayload(itemWithValid).product_id).toBe(
      '14c1652a-9a48-441b-be9d-6c9da6e11a95'
    );
  });
});

describe('createPurchaseBillService RPC and fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses create_purchase_bill RPC when RPC succeeds', async () => {
    const rpcMock = (supabase as any)._mocks.rpcMock;
    rpcMock.mockResolvedValueOnce({
      data: [{ bill_id: 'bill-rpc-999' }],
      error: null,
    });

    const res = await createPurchaseBillService({
      businessId: 'biz-1',
      bill: { supplier_id: '14c1652a-9a48-441b-be9d-6c9da6e11a95', bill_number: 'PB/26-27/001' },
      items: [{ product_id: 'ede3cbe7-cb34-48a2-893b-447e4a2b9038', product_name: 'Item 1', quantity: 1, rate: 100 }],
    });

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ bill_id: 'bill-rpc-999' }]);
    expect(rpcMock).toHaveBeenCalledWith('create_purchase_bill', expect.any(Object));
  });

  it('falls back to direct table inserts when RPC fails with 404 / PGRST202 or missing relation', async () => {
    const rpcMock = (supabase as any)._mocks.rpcMock;
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.create_purchase_bill in the schema cache', status: 404 },
    });

    const res = await createPurchaseBillService({
      businessId: 'biz-1',
      bill: { supplier_id: '14c1652a-9a48-441b-be9d-6c9da6e11a95', bill_number: 'PB/26-27/002', grand_total: 5000 },
      items: [{ product_id: 'ede3cbe7-cb34-48a2-893b-447e4a2b9038', product_name: 'Submersible Pump', quantity: 1, rate: 5000, total_amount: 5000 }],
      status: 'confirmed',
    });

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ bill_id: 'bill-fallback-123', journal_entry_id: null }]);
  });

  it('returns 23505 unique constraint violation error to allow caller retry', async () => {
    const rpcMock = (supabase as any)._mocks.rpcMock;
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const res = await createPurchaseBillService({
      businessId: 'biz-1',
      bill: { supplier_id: '14c1652a-9a48-441b-be9d-6c9da6e11a95', bill_number: 'PB/26-27/001' },
      items: [{ product_name: 'Item 1', quantity: 1, rate: 100 }],
    });

    expect(res.error).toEqual(expect.objectContaining({ code: '23505' }));
    expect(res.data).toBeNull();
  });
});
