import type { Business, Customer, SalesInvoice, SalesInvoiceItem } from '@/types/db';
import { formatDate, formatCurrency, formatNumber } from '@/lib/utils';
import { captureElementToPdf } from '@/lib/pdfCapture';

/** Invoice record joined with its customer (the shape the invoice pages carry). */
export type InvoiceWithCustomer = SalesInvoice & { customer: Customer | null };

function sanitizeFilenamePart(s: string): string {
  return (s || '').replace(/[/\\?%*:|"<>\n\r]+/g, '-').trim() || 'INV';
}

export function invoicePdfFilename(invoiceNumber: string, partyName?: string | null): string {
  return `Invoice_${sanitizeFilenamePart(invoiceNumber)}_${sanitizeFilenamePart(partyName || '')}.pdf`;
}

import { printElementInIframe } from '@/components/documents/UniversalDocumentTemplate';

/** Isolated iframe print of the UniversalDocumentTemplate (#invoice-printable-area). */
export function printInvoice(): void {
  printElementInIframe('invoice-printable-area', 'Tax Invoice');
}

/** Capture an already-rendered sheet element (live preview / view page). */
export async function exportPdfFromElement(el: HTMLElement | null, invoiceNumber: string, partyName?: string | null): Promise<void> {
  if (!el) throw new Error('Invoice preview not found');
  await captureElementToPdf(el, invoicePdfFilename(invoiceNumber, partyName));
}

export async function fetchInvoiceItems(invoiceId: string): Promise<SalesInvoiceItem[]> {
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase
    .from('sales_invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at');
  if (error) throw error;
  return (data || []) as SalesInvoiceItem[];
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Structured invoice workbook (.csv opens natively in Excel; no SheetJS per ruling).
 * Layout: business header block → items table → summary block.
 * UTF-8 BOM prefix ensures Excel decodes ₹ and Devanagari-safe text cleanly
 * (the raw bytes otherwise render as the mojibake "ï»¿" artifact).
 */
export function exportInvoiceExcel(
  business: Business | null,
  invoice: InvoiceWithCustomer,
  items: SalesInvoiceItem[]
): void {
  const customer = invoice.customer as Partial<Customer> | null | undefined;
  const sym = business?.currency_symbol || '₹';
  const lines: string[] = [];

  // Header block
  lines.push(['Business Name', business?.legal_name || business?.name || '—'].map(csvCell).join(','));
  lines.push(['GSTIN', business?.gstin || '—'].map(csvCell).join(','));
  lines.push(['Invoice No', invoice.invoice_number].map(csvCell).join(','));
  lines.push(['Invoice Date', formatDate(invoice.invoice_date)].map(csvCell).join(','));
  if (invoice.due_date) lines.push(['Due Date', formatDate(invoice.due_date)].map(csvCell).join(','));
  lines.push(['Customer Name', customer?.company_name || customer?.name || '—'].map(csvCell).join(','));
  lines.push('');

  // Items table
  const ITEM_COLUMNS = ['Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount (%)', 'Taxable Amount', 'CGST', 'SGST', 'Total Amount'];
  lines.push(ITEM_COLUMNS.join(','));
  for (const it of items) {
    const gross = Number(it.quantity) * Number(it.rate);
    const discPct = gross > 0 ? Math.round((Number(it.discount_amount) / gross) * 100) : 0;
    lines.push([
      it.product_name || '—',
      it.hsn_sac || '—',
      `${formatNumber(Number(it.quantity))} ${it.unit || ''}`.trim(),
      formatCurrency(Number(it.rate), sym),
      `${discPct}%`,
      formatCurrency(Number(it.taxable_amount), sym),
      formatCurrency(Number(it.cgst_amount) + Number(it.sgst_amount) > 0 ? Number(it.cgst_amount) : 0, sym),
      formatCurrency(Number(it.cgst_amount) + Number(it.sgst_amount) > 0 ? Number(it.sgst_amount) : 0, sym),
      formatCurrency(Number(it.total_amount), sym),
    ].map(csvCell).join(','));
  }
  lines.push('');

  // Summary block
  const totalTax =
    Number(invoice.cgst_amount) + Number(invoice.sgst_amount) + Number(invoice.igst_amount) + Number(invoice.cess_amount);
  lines.push(['Subtotal', formatCurrency(Number(invoice.subtotal), sym)].map(csvCell).join(','));
  lines.push(['Total Tax', formatCurrency(totalTax, sym)].map(csvCell).join(','));
  lines.push(['Grand Total', formatCurrency(Number(invoice.grand_total), sym)].map(csvCell).join(','));

  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilenamePart(invoice.invoice_number)}_export.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
