import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeUuid,
  sanitizePurchaseBillPayload,
  sanitizePurchaseBillItemPayload,
} from './purchaseBillService';
import { documentNumberTaken } from '@/lib/numbering';

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
