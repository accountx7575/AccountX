import { supabase } from '@/lib/supabase';
import type { PurchaseBill, PurchaseBillItem } from '@/types/db';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates and sanitizes a UUID foreign key.
 * Returns null if the value is null, undefined, empty, '_none_', '__none__', 'none',
 * or not a valid UUID string.
 */
export function sanitizeUuid(val?: unknown): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (
    !str ||
    str === '_none_' ||
    str === '__none__' ||
    str === 'none' ||
    str.toLowerCase() === 'null' ||
    str.toLowerCase() === 'undefined'
  ) {
    return null;
  }
  return UUID_REGEX.test(str) ? str : null;
}

/**
 * Sanitizes purchase bill header payload before submitting to Supabase.
 * Ensures foreign keys and date values conform to PostgreSQL types.
 */
export function sanitizePurchaseBillPayload<T extends Record<string, any>>(payload: T): T {
  const clean: Record<string, any> = { ...payload };

  // Common UUID foreign key fields on purchase bills and payments
  const uuidFields = [
    'id',
    'business_id',
    'supplier_id',
    'bank_account_id',
    'warehouse_id',
    'payment_account_id',
    'account_id',
    'created_by',
  ];

  for (const field of uuidFields) {
    if (field in clean) {
      clean[field] = sanitizeUuid(clean[field]);
    }
  }

  // Sanitize due_date: empty or placeholder string becomes null
  if ('due_date' in clean) {
    const d = clean.due_date;
    clean.due_date = typeof d === 'string' && d.trim() && d !== '_none_' && d !== 'none'
      ? d.trim()
      : null;
  }

  // Sanitize notes & payment_method
  if ('notes' in clean) {
    const n = clean.notes;
    clean.notes = typeof n === 'string' && n.trim() ? n.trim() : null;
  }
  if ('payment_method' in clean) {
    const pm = clean.payment_method;
    clean.payment_method = typeof pm === 'string' && pm.trim() && pm !== '_none_' && pm !== 'none'
      ? pm.trim()
      : null;
  }

  return clean as T;
}

/**
 * Sanitizes purchase bill line items.
 * Ensures product_id is a valid UUID or null (e.g. for ad-hoc custom items).
 */
export function sanitizePurchaseBillItemPayload<T extends Record<string, any>>(item: T): T {
  return {
    ...item,
    product_id: sanitizeUuid(item.product_id),
  };
}

export type CreatePurchaseBillParams = {
  businessId: string;
  bill: Record<string, any>;
  items: Array<Record<string, any>>;
  status?: 'confirmed' | 'draft';
};

/**
 * Submits a new purchase bill to Supabase with sanitized UUIDs and line items.
 */
export async function createPurchaseBillService({
  businessId,
  bill,
  items,
  status = 'confirmed',
}: CreatePurchaseBillParams) {
  const cleanBill = sanitizePurchaseBillPayload(bill);
  const cleanItems = items.map(sanitizePurchaseBillItemPayload);

  return supabase.rpc('create_purchase_bill', {
    p_business_id: businessId,
    p_bill: cleanBill,
    p_items: cleanItems,
    p_status: status,
  });
}
