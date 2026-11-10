import { supabase } from '@/lib/supabase';
import { isUuid, roundTo2 } from '@/lib/utils';

export interface UpdateSalesInvoiceParams {
  businessId: string;
  invoiceId: string;
  invoiceData: Record<string, any>;
  items: Array<{
    product_id?: string | null;
    product_name: string;
    hsn_sac?: string | null;
    quantity: number;
    unit?: string | null;
    rate: number;
    discount_amount?: number;
    tax_rate?: number;
    taxable_amount?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    igst_amount?: number;
    cess_amount?: number;
    total_amount?: number;
  }>;
}

export function buildSalesInvoiceItemRows(
  businessId: string,
  invoiceId: string,
  items: Array<any>
) {
  return items.map((it) => ({
    business_id: businessId,
    invoice_id: invoiceId,
    product_id: it.product_id && isUuid(it.product_id) ? it.product_id : null,
    product_name: it.product_name || 'Item',
    hsn_sac: it.hsn_sac || '',
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
}

export interface CreateSalesInvoiceParams {
  businessId: string;
  invoice: Record<string, any>;
  items: Array<Record<string, any>>;
  status: 'issued' | 'draft';
}

/**
 * Creates a sales invoice. Attempts the transactional RPC first, then falls
 * back to direct table operations (mirroring migration 030's contract) so
 * invoice saving never blocks on a missing/mismatched DB function:
 *   1. insert headers into sales_invoices (numbered, status, unpaid balance)
 *   2. insert items into sales_invoice_items
 *   3. issued only: deduct products.current_stock + stock_movements
 *   4. issued only: post journal (best-effort) + customer balance/total_sales
 */
export async function createSalesInvoiceService({
  businessId,
  invoice,
  items,
  status,
}: CreateSalesInvoiceParams): Promise<{ invoiceId: string }> {
  // 1. Attempt transactional RPC first
  try {
    const { data, error: rpcError } = await supabase.rpc('create_sales_invoice', {
      p_business_id: businessId,
      p_invoice: invoice,
      p_items: items,
      p_status: status,
    } as any);

    if (!rpcError) {
      const result = data as unknown as
        | { invoice_id?: string }[]
        | { invoice_id?: string }
        | null;
      const invoiceId = Array.isArray(result)
        ? result[0]?.invoice_id
        : (result as any)?.invoice_id;
      return { invoiceId: invoiceId || '' };
    }

    console.warn(
      '[salesInvoiceService] create_sales_invoice RPC failed (falling back to direct save):',
      rpcError
    );
  } catch (rpcErr) {
    console.warn(
      '[salesInvoiceService] create_sales_invoice RPC exception (falling back to direct save):',
      rpcErr
    );
  }

  const isDraft = status === 'draft';

  // 2a. Numbering: explicit or server counter (parity with the RPC's COALESCE)
  let invoiceNumber = String(invoice.invoice_number || '').trim();
  if (!invoiceNumber) {
    const { data: generated, error: counterError } = await supabase.rpc(
      'next_document_number',
      {
        p_business_id: businessId,
        p_doc_type: 'sales_invoice',
        ...(invoice.invoice_date ? { p_date: String(invoice.invoice_date) } : {}),
      } as any
    );
    if (counterError) throw counterError;
    invoiceNumber = typeof generated === 'string' ? generated.trim() : '';
  }
  if (!invoiceNumber) {
    throw new Error('Could not allocate an invoice number before saving');
  }

  // 2b. Insert headers (RPC parity: paid 0, unpaid, balance = grand_total)
  const grandTotal = Number(invoice.grand_total) || 0;
  const { data: inserted, error: insertError } = await supabase
    .from('sales_invoices')
    .insert({
      ...invoice,
      business_id: businessId,
      invoice_number: invoiceNumber,
      paid_amount: 0,
      balance_amount: grandTotal,
      payment_status: 'unpaid',
      status: isDraft ? 'draft' : 'issued',
    })
    .select('id, invoice_number')
    .single();

  if (insertError) throw insertError;
  const invoiceId = String(inserted.id);

  // 2c. Insert all line items
  const rows = buildSalesInvoiceItemRows(businessId, invoiceId, items);
  const { error: itemsError } = await supabase
    .from('sales_invoice_items')
    .insert(rows);

  if (itemsError) throw itemsError;

  if (!isDraft) {
    // 2d. Stock is an EVENT: deduct stock and record movements (issued only)
    for (const it of items) {
      const pid = it.product_id;
      if (!pid || !isUuid(pid)) continue;
      try {
        const { data: prod } = await supabase
          .from('products')
          .select('current_stock, type')
          .eq('id', pid)
          .eq('business_id', businessId)
          .maybeSingle();

        if (prod && prod.type === 'product') {
          const qty = Number(it.quantity) || 1;
          const newStock = roundTo2((Number(prod.current_stock) || 0) - qty);

          await supabase
            .from('products')
            .update({ current_stock: newStock })
            .eq('id', pid)
            .eq('business_id', businessId);

          await supabase.from('stock_movements').insert({
            business_id: businessId,
            product_id: pid,
            type: 'sale',
            quantity: -qty,
            balance_after: newStock,
            reference_type: 'sales_invoice',
            reference_id: invoiceId,
            notes: `Invoice ${invoiceNumber} (direct save)`,
          });
        }
      } catch (stockErr) {
        console.warn('[salesInvoiceService] Stock sync skipped/warning:', stockErr);
      }
    }

    // 2e. Journal entry: non-blocking best-effort (mirrors the RPC's last step)
    try {
      await supabase.rpc('post_sales_invoice_journal', { p_invoice_id: invoiceId } as any);
    } catch (jeErr) {
      console.warn('[salesInvoiceService] post_sales_invoice_journal skipped:', jeErr);
    }

    // 2f. Customer current_balance/total_sales (issued-only; parity with the issue flow)
    const customerId = invoice.customer_id;
    if (customerId && isUuid(customerId)) {
      try {
        const { data: cust } = await supabase
          .from('customers')
          .select('current_balance, total_sales')
          .eq('id', customerId)
          .maybeSingle();

        if (cust) {
          await supabase
            .from('customers')
            .update({
              current_balance: roundTo2((Number(cust.current_balance) || 0) + grandTotal),
              total_sales: roundTo2((Number(cust.total_sales) || 0) + grandTotal),
              last_transaction_date: new Date().toISOString(),
            })
            .eq('id', customerId);
        }
      } catch (custErr) {
        console.warn('[salesInvoiceService] Customer balance warning:', custErr);
      }
    }
  }

  // 2g. Audit log (best-effort)
  try {
    await supabase.from('audit_logs').insert({
      business_id: businessId,
      action: 'invoice_created',
      entity_type: 'sales_invoice',
      entity_id: invoiceId,
      description: isDraft
        ? `Invoice ${invoiceNumber} saved as DRAFT (direct save)`
        : `Invoice ${invoiceNumber} created via direct save`,
    });
  } catch {
    // ignore
  }

  return { invoiceId };
}

export async function updateSalesInvoiceService(params: UpdateSalesInvoiceParams) {
  const { businessId, invoiceId, invoiceData, items } = params;

  // Ensure invoice_time and time are synchronized if provided
  const headerData = { ...invoiceData };
  if (headerData.invoice_time && !headerData.time) {
    headerData.time = headerData.invoice_time;
  } else if (headerData.time && !headerData.invoice_time) {
    headerData.invoice_time = headerData.time;
  }

  // 1. Update header
  const { data: updatedInvoice, error: headerError } = await supabase
    .from('sales_invoices')
    .update(headerData)
    .eq('business_id', businessId)
    .eq('id', invoiceId)
    .select()
    .single();

  if (headerError) throw headerError;

  // 2. Clear previous items
  const { error: clearError } = await supabase
    .from('sales_invoice_items')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('business_id', businessId);

  if (clearError) throw clearError;

  // 3. Insert fresh items with guaranteed business_id
  const rows = buildSalesInvoiceItemRows(businessId, invoiceId, items);

  const { data: insertedItems, error: itemsError } = await supabase
    .from('sales_invoice_items')
    .insert(rows)
    .select();

  if (itemsError) throw itemsError;

  return { invoice: updatedInvoice, items: insertedItems };
}

export interface IssueSalesInvoiceParams {
  businessId: string;
  invoiceId: string;
}

/**
 * Promotes a draft sales invoice to 'issued' status.
 * Attempts transactional RPC first, but gracefully falls back to direct table updates
 * (deducting inventory, updating customer balance, and posting journal)
 * if the RPC fails or is missing.
 */
export async function issueSalesInvoiceService({
  businessId,
  invoiceId,
}: IssueSalesInvoiceParams): Promise<{ success: boolean; invoice?: any }> {
  // 1. Attempt transactional RPC first
  try {
    const { error: rpcError } = await supabase.rpc('issue_document', {
      p_business_id: businessId,
      p_doc_type: 'sales_invoice',
      p_doc_id: invoiceId,
    });

    if (!rpcError) {
      return { success: true };
    }

    console.warn(
      '[salesInvoiceService] issue_document RPC warning (falling back to direct issue):',
      rpcError
    );
  } catch (rpcErr) {
    console.warn(
      '[salesInvoiceService] issue_document RPC exception (falling back to direct issue):',
      rpcErr
    );
  }

  // 2. Direct client-side update fallback
  // 2a. Update status to 'issued' and fetch lines + customer info
  const { data: inv, error: updateError } = await supabase
    .from('sales_invoices')
    .update({
      status: 'issued',
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('business_id', businessId)
    .select('*, items:sales_invoice_items(*)')
    .single();

  if (updateError) throw updateError;

  // 2b. Deduct stock from products.current_stock
  const rawItems = inv?.items || [];
  for (const it of rawItems) {
    if (it.product_id && isUuid(it.product_id)) {
      try {
        const { data: prod } = await supabase
          .from('products')
          .select('current_stock')
          .eq('id', it.product_id)
          .maybeSingle();

        if (prod) {
          const qty = Number(it.quantity) || 1;
          const newStock = roundTo2((Number(prod.current_stock) || 0) - qty);

          await supabase
            .from('products')
            .update({
              current_stock: newStock,
              updated_at: new Date().toISOString(),
            })
            .eq('id', it.product_id);

          await supabase.from('stock_movements').insert({
            business_id: businessId,
            product_id: it.product_id,
            type: 'sale',
            quantity: -qty,
            balance_after: newStock,
            reference_type: 'sales_invoice',
            reference_id: invoiceId,
            notes: `Invoice ${inv.invoice_number} issued`,
          });
        }
      } catch (stockErr) {
        console.warn('[salesInvoiceService] Stock sync skipped/warning:', stockErr);
      }
    }
  }

  // 2c. Update customer current_balance and total_sales
  if (inv.customer_id && isUuid(inv.customer_id)) {
    try {
      const { data: cust } = await supabase
        .from('customers')
        .select('current_balance, total_sales')
        .eq('id', inv.customer_id)
        .maybeSingle();

      if (cust) {
        const newBalance = roundTo2(
          (Number(cust.current_balance) || 0) + (Number(inv.balance_amount ?? inv.grand_total) || 0)
        );
        const newSales = roundTo2(
          (Number(cust.total_sales) || 0) + (Number(inv.grand_total) || 0)
        );

        await supabase
          .from('customers')
          .update({
            current_balance: newBalance,
            total_sales: newSales,
            last_transaction_date: new Date().toISOString(),
          })
          .eq('id', inv.customer_id);
      }
    } catch (custErr) {
      console.warn('[salesInvoiceService] Customer balance warning:', custErr);
    }
  }

  // 2d. Post journal entry non-blockingly
  try {
    await supabase.rpc('post_sales_invoice_journal', { p_invoice_id: invoiceId });
  } catch (jeErr) {
    console.warn('[salesInvoiceService] post_sales_invoice_journal skipped:', jeErr);
  }

  // 2e. Audit log
  try {
    await supabase.from('audit_logs').insert({
      business_id: businessId,
      action: 'document_issued',
      entity_type: 'sales_invoice',
      entity_id: invoiceId,
      description: `Invoice ${inv.invoice_number} issued from draft`,
    });
  } catch {
    // ignore
  }

  return { success: true, invoice: inv };
}
