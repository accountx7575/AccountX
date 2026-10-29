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
