import { supabase } from './supabase';
import { allocateDocumentNumber } from './numbering';
import type { DocumentType } from './payloads';

export type ConvertedDoc = { new_doc_id: string; new_doc_number: string };

export type ConvertArgs = {
  businessId: string;
  quotationId: string;
  invoiceDate: string;
  dueDate?: string | null;
};

const CONVERTIBLE_STATUSES = ['sent', 'accepted'];

export function isOverloadResolutionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.code === '42725' || e.code === 'PGRST203') return true;
  return /is not unique|best candidate|could not choose/i.test(e.message || '');
}

type QuotationRow = {
  quotation_number: string;
  customer_id: string;
  status: string;
  converted_doc_id: string | null;
  invoice_date?: string;
  due_date?: string | null;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  cess_amount: number;
  round_off: number;
  grand_total: number;
  notes: string | null;
  terms: string | null;
  customer: { state: string | null } | null;
};

async function insertQuotationInvoiceManually(args: ConvertArgs): Promise<ConvertedDoc> {
  const { businessId, quotationId, invoiceDate, dueDate } = args;

  const { data: quote, error: quoteError } = await supabase
    .from('quotations')
    .select('*, customer:customers(state)')
    .eq('id', quotationId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (quoteError) throw quoteError;
  const q = quote as QuotationRow | null;
  if (!q) throw new Error('Quotation not found in this business');
  if (q.status === 'converted' || q.converted_doc_id) {
    throw new Error(`Quotation ${q.quotation_number} has already been converted`);
  }
  if (!CONVERTIBLE_STATUSES.includes(q.status)) {
    throw new Error(`Only sent or accepted quotations can be converted (current status: ${q.status})`);
  }

  const { data: items, error: itemsError } = await supabase
    .from('quotation_items')
    .select('*')
    .eq('quotation_id', quotationId)
    .order('created_at');
  if (itemsError) throw itemsError;
  if (!items || items.length === 0) {
    throw new Error('Quotation has no items to convert');
  }

  const invoiceNumber = await allocateDocumentNumber({
    businessId,
    docType: 'sales_invoice' as DocumentType,
    table: 'sales_invoices',
    numberColumn: 'invoice_number',
    date: invoiceDate,
  });

  const { data: invoice, error: invoiceError } = await supabase
    .from('sales_invoices')
    .insert({
      business_id: businessId,
      customer_id: q.customer_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      place_of_supply: q.customer?.state || null,
      subtotal: q.subtotal,
      discount_amount: q.discount_amount,
      taxable_amount: q.taxable_amount,
      cgst_amount: q.cgst_amount,
      sgst_amount: q.sgst_amount,
      igst_amount: q.igst_amount,
      cess_amount: q.cess_amount,
      round_off: q.round_off,
      grand_total: q.grand_total,
      paid_amount: 0,
      balance_amount: q.grand_total,
      payment_status: 'unpaid',
      status: 'issued',
      notes: q.notes,
      terms: q.terms,
    })
    .select('id, invoice_number')
    .single();
  if (invoiceError) throw invoiceError;

  const { error: itemInsertError } = await supabase.from('sales_invoice_items').insert(
    (items as Record<string, unknown>[]).map((it) => ({
      business_id: businessId,
      invoice_id: invoice.id,
      product_id: it.product_id,
      product_name: it.product_name,
      hsn_sac: it.hsn_sac,
      quantity: it.quantity,
      unit: it.unit || 'PCS',
      rate: it.rate,
      discount_amount: it.discount_amount,
      tax_rate: it.tax_rate,
      taxable_amount: it.taxable_amount,
      cgst_amount: it.cgst_amount,
      sgst_amount: it.sgst_amount,
      igst_amount: it.igst_amount,
      cess_amount: it.cess_amount,
      total_amount: it.total_amount,
    }))
  );
  if (itemInsertError) throw itemInsertError;

  const { data: claimed, error: claimError } = await supabase
    .from('quotations')
    .update({ status: 'converted', converted_doc_id: invoice.id })
    .eq('id', quotationId)
    .eq('status', q.status)
    .select('id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    throw new Error('Quotation state changed during conversion - retry');
  }

  return { new_doc_id: invoice.id, new_doc_number: invoice.invoice_number };
}

export async function convertQuotationToInvoice(args: ConvertArgs): Promise<ConvertedDoc> {
  const { data, error } = await supabase.rpc('convert_quotation_to_invoice', {
    p_business_id: args.businessId,
    p_quotation_id: args.quotationId,
    p_invoice_date: args.invoiceDate,
    p_due_date: args.dueDate ?? null,
  });
  if (error) {
    if (isOverloadResolutionError(error)) {
      return insertQuotationInvoiceManually(args);
    }
    throw error;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { new_doc_id?: string; new_doc_number?: string }
    | null
    | undefined;
  return {
    new_doc_id: row?.new_doc_id || '',
    new_doc_number: row?.new_doc_number || 'invoice',
  };
}
