import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/utils';

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

  // 1. Update header
  const { data: updatedInvoice, error: headerError } = await supabase
    .from('sales_invoices')
    .update(invoiceData)
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
