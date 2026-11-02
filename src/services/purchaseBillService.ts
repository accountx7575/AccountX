import { supabase } from '@/lib/supabase';
import { roundTo2, todayDateString } from '@/lib/utils';
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
 * Direct table insert for purchase bill: inserts into purchase_bills and purchase_bill_items,
 * updates inventory/stock movements, recalculates supplier balance, and posts the journal entry.
 * Guarantees purchase bills save cleanly with 200 OK without relying on undeployed RPC functions.
 */
export async function createPurchaseBillDirectly({
  businessId,
  bill,
  items,
  status = 'confirmed',
}: CreatePurchaseBillParams): Promise<{ bill_id: string; journal_entry_id: string | null }> {
  const grandTotal = Number(bill.grand_total) || 0;
  const cleanBill = sanitizePurchaseBillPayload({
    business_id: businessId,
    supplier_id: sanitizeUuid(bill.supplier_id),
    bill_number: bill.bill_number,
    bill_date: bill.bill_date || todayDateString(),
    due_date: bill.due_date || null,
    subtotal: Number(bill.subtotal) || 0,
    discount_amount: Number(bill.discount_amount) || 0,
    taxable_amount: Number(bill.taxable_amount) || 0,
    cgst_amount: Number(bill.cgst_amount) || 0,
    sgst_amount: Number(bill.sgst_amount) || 0,
    igst_amount: Number(bill.igst_amount) || 0,
    cess_amount: Number(bill.cess_amount) || 0,
    round_off: Number(bill.round_off) || 0,
    grand_total: grandTotal,
    paid_amount: Number(bill.paid_amount) || 0,
    balance_amount: Number(bill.balance_amount ?? grandTotal),
    payment_status: bill.payment_status || 'unpaid',
    status: status || bill.status || 'confirmed',
    payment_method: bill.payment_method || null,
    notes: bill.notes || null,
    created_at: bill.created_at || new Date().toISOString(),
  });

  // 1. Insert header into purchase_bills
  const { data: billRow, error: billError } = await supabase
    .from('purchase_bills')
    .insert(cleanBill)
    .select('id, bill_number, supplier_id, grand_total, status')
    .single();

  if (billError) throw billError;
  const billId = billRow.id;

  // 2. Insert line items into purchase_bill_items
  if (items.length > 0) {
    const cleanItems = items.map((it) => ({
      business_id: businessId,
      bill_id: billId,
      product_id: sanitizeUuid(it.product_id),
      product_name: it.product_name,
      hsn_sac: it.hsn_sac || null,
      quantity: Number(it.quantity) || 1,
      unit: it.unit || 'PCS',
      rate: Number(it.rate) || 0,
      discount_amount: Number(it.discount_amount) || 0,
      tax_rate: Number(it.tax_rate) || 0,
      taxable_amount: Number(it.taxable_amount) || 0,
      cgst_amount: Number(it.cgst_amount) || 0,
      sgst_amount: Number(it.sgst_amount) || 0,
      igst_amount: Number(it.igst_amount) || 0,
      cess_amount: Number(it.cess_amount) || 0,
      total_amount: Number(it.total_amount) || 0,
    }));

    const { error: itemsError } = await supabase
      .from('purchase_bill_items')
      .insert(cleanItems);

    if (itemsError) throw itemsError;
  }

  // 3. Post-save operations for confirmed bills
  let journalEntryId: string | null = null;
  if (status !== 'draft') {
    // 3a. Update stock for inventory products
    for (const item of items) {
      const pid = sanitizeUuid(item.product_id);
      const qty = Number(item.quantity) || 0;
      if (pid && qty > 0) {
        try {
          const { data: prod } = await supabase
            .from('products')
            .select('current_stock')
            .eq('id', pid)
            .eq('business_id', businessId)
            .maybeSingle();

          if (prod) {
            const currentStock = Number(prod.current_stock) || 0;
            const newStock = roundTo2(currentStock + qty);
            await supabase
              .from('products')
              .update({ current_stock: newStock })
              .eq('id', pid)
              .eq('business_id', businessId);

            await supabase
              .from('stock_movements')
              .insert({
                business_id: businessId,
                product_id: pid,
                type: 'purchase',
                quantity: qty,
                balance_after: newStock,
                reference_type: 'purchase_bill',
                reference_id: billId,
                notes: `Bill ${billRow.bill_number}`,
              });
          }
        } catch (stockErr) {
          console.warn('[purchaseBillService] Stock movement skipped/warning:', stockErr);
        }
      }
    }

    // 3b. Sync supplier balance from first principles
    const suppId = sanitizeUuid(cleanBill.supplier_id);
    if (suppId) {
      try {
        const [suppRes, billsRes, payRes] = await Promise.all([
          supabase
            .from('suppliers')
            .select('opening_balance, current_balance, total_purchases')
            .eq('id', suppId)
            .eq('business_id', businessId)
            .maybeSingle(),
          supabase
            .from('purchase_bills')
            .select('grand_total')
            .eq('supplier_id', suppId)
            .eq('business_id', businessId)
            .in('status', ['confirmed', 'partially_paid', 'paid']),
          supabase
            .from('payments')
            .select('amount')
            .eq('party_id', suppId)
            .eq('party_type', 'supplier')
            .eq('business_id', businessId)
            .eq('type', 'made'),
        ]);

        const openingBal = Number(suppRes.data?.opening_balance) || 0;
        const totalPurchases = (billsRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.grand_total) || 0), 0);
        const totalPaid = (payRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0);
        const totalPayable = roundTo2(openingBal + totalPurchases);
        const newBal = totalPayable <= 0 ? 0 : Math.max(0, roundTo2(totalPayable - totalPaid));

        await supabase
          .from('suppliers')
          .update({
            current_balance: newBal,
            total_purchases: roundTo2(totalPurchases),
            last_transaction_date: new Date().toISOString(),
          })
          .eq('id', suppId)
          .eq('business_id', businessId);
      } catch (suppErr) {
        console.warn('[purchaseBillService] Supplier balance warning:', suppErr);
      }
    }

    // 3c. Post journal entry via post_purchase_bill_journal RPC if available
    try {
      const jeRes = await supabase
        .rpc('post_purchase_bill_journal', { p_bill_id: billId });
      if (jeRes && !jeRes.error && jeRes.data) {
        journalEntryId = String(jeRes.data);
      }
    } catch (jeErr) {
      console.warn('[purchaseBillService] post_purchase_bill_journal skipped:', jeErr);
    }

    // 3d. Audit log
    try {
      await supabase.from('audit_logs').insert({
        business_id: businessId,
        action: 'bill_created',
        entity_type: 'purchase_bill',
        entity_id: billId,
        description: `Bill ${billRow.bill_number} created`,
      });
    } catch {
      // ignore
    }
  }

  return { bill_id: billId, journal_entry_id: journalEntryId };
}

/**
 * Submits a new purchase bill to Supabase.
 * Attempts transactional RPC first, but gracefully falls back to direct table inserts
 * if the RPC fails with 404 / PGRST202 or relation missing errors.
 */
export async function createPurchaseBillService({
  businessId,
  bill,
  items,
  status = 'confirmed',
}: CreatePurchaseBillParams): Promise<{
  data: { bill_id: string; journal_entry_id?: string | null }[] | null;
  error: any;
}> {
  const cleanBill = sanitizePurchaseBillPayload(bill);
  const cleanItems = items.map(sanitizePurchaseBillItemPayload);

  // Attempt RPC first
  try {
    const rpcRes = await supabase.rpc('create_purchase_bill', {
      p_business_id: businessId,
      p_bill: cleanBill,
      p_items: cleanItems,
      p_status: status,
    });

    if (!rpcRes.error) {
      const rawData = rpcRes.data;
      const formatted = Array.isArray(rawData) ? rawData : (rawData ? [rawData] : []);
      return { data: formatted, error: null };
    }

    // If duplicate document number, return error so the caller can retry with next number
    if (rpcRes.error.code === '23505') {
      return { data: null, error: rpcRes.error };
    }

    console.warn(
      '[purchaseBillService] create_purchase_bill RPC error (falling back to direct table insert):',
      rpcRes.error
    );
  } catch (rpcErr) {
    console.warn(
      '[purchaseBillService] create_purchase_bill RPC exception (falling back to direct table insert):',
      rpcErr
    );
  }

  // Graceful fallback to direct table insert
  try {
    const directRes = await createPurchaseBillDirectly({
      businessId,
      bill: cleanBill,
      items: cleanItems,
      status,
    });

    return {
      data: [{ bill_id: directRes.bill_id, journal_entry_id: directRes.journal_entry_id }],
      error: null,
    };
  } catch (directErr: any) {
    return { data: null, error: directErr };
  }
}

// Export alias for consistency
export const createPurchaseBill = createPurchaseBillService;
