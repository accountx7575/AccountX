import React from 'react';
import { Building2, ShieldCheck, Printer, Download } from 'lucide-react';
import { amountInWordsIndian, formatDate } from '@/lib/utils';

export type DocumentType =
  | 'TAX_INVOICE'
  | 'QUOTATION'
  | 'SALES_ORDER'
  | 'PURCHASE_ORDER'
  | 'PURCHASE_BILL';

export interface PartyDetails {
  name: string;
  companyName?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  email?: string;
  phone?: string;
  logoUrl?: string;
}

export interface DocumentLineItem {
  id?: string;
  name: string;
  hsnSac?: string;
  quantity: number;
  rate: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
  unit?: string;
}

export interface UniversalDocumentData {
  documentType: DocumentType;
  documentNumber: string;
  date: string;
  dueDate?: string;
  status?: string;
  placeOfSupply?: string;
  supplyType?: string; // e.g. "Intra-State (CGST + SGST)" or "Inter-State (IGST)"
  reverseCharge?: 'Yes' | 'No';
  orderRef?: string;
  paymentMode?: string;
  paymentStatus?: string;
  seller: PartyDetails;
  buyer: PartyDetails;
  items: DocumentLineItem[];
  subtotal: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  discount?: number;
  roundOff?: number;
  grandTotal: number;
  amountInWords?: string;
  taxNote?: string;
  terms?: string[];
  bankDetails?: {
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    ifsc?: string;
  };
  notes?: string;
}

export const getDocumentTitles = (type: DocumentType) => {
  switch (type) {
    case 'QUOTATION':
      return { header: 'QUOTATION / ESTIMATE', sub: 'Commercial Quotation' };
    case 'SALES_ORDER':
      return { header: 'SALES ORDER', sub: 'Original Order Confirmation' };
    case 'PURCHASE_ORDER':
      return { header: 'PURCHASE ORDER', sub: 'Vendor Purchase Requisition' };
    case 'PURCHASE_BILL':
      return { header: 'PURCHASE BILL / INWARD', sub: 'Tax Inward Receipt' };
    case 'TAX_INVOICE':
    default:
      return { header: 'TAX INVOICE / RECEIPT', sub: 'Original for Recipient' };
  }
};

/**
 * Isolated iframe printing helper ensuring clean 1-page A4 output
 * with background colors preserved and without browser chrome or page clipping.
 */
export function printElementInIframe(
  target: string | HTMLElement,
  title: string = 'Document'
): void {
  const element =
    typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) {
    window.print();
    return;
  }

  // Remove existing print iframe if any
  const oldIframe = document.getElementById('accountx-isolated-print-iframe');
  if (oldIframe) {
    oldIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'accountx-isolated-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    window.print();
    return;
  }

  // Copy current stylesheets so Tailwind styling and fonts load in iframe
  const styles = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  )
    .map((el) => el.outerHTML)
    .join('\n');

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        ${styles}
        <style>
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            box-sizing: border-box;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff !important;
            color: #1e293b;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          }
          #print-root {
            width: 100%;
            max-width: 194mm;
            margin: 0 auto;
          }
        </style>
      </head>
      <body>
        <div id="print-root">
          ${element.outerHTML}
        </div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    try {
      iframe.contentWindow?.print();
    } catch {
      window.print();
    }
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        iframe.remove();
      }
    }, 2500);
  }, 400);
}

/**
 * UniversalDocumentTemplate:
 * Standardized GyftKart-inspired GST-compliant printable & preview document.
 */
export const UniversalDocumentTemplate: React.FC<{
  data: UniversalDocumentData;
  className?: string;
  id?: string;
}> = ({ data, className = '', id = 'universal-printable-area' }) => {
  const titles = getDocumentTitles(data.documentType);
  const isPurchase =
    data.documentType === 'PURCHASE_BILL' ||
    data.documentType === 'PURCHASE_ORDER';

  const sellerName = data.seller.companyName || data.seller.name || 'Company';
  const buyerName = data.buyer.companyName || data.buyer.name || 'Party';
  const initial = (sellerName.charAt(0) || 'A').toUpperCase();

  // Full formatted address
  const sellerAddress = [
    data.seller.address,
    [data.seller.city, data.seller.state, data.seller.pincode]
      .filter(Boolean)
      .join(', '),
  ]
    .filter(Boolean)
    .join('\n');

  const buyerAddress = [
    data.buyer.address,
    [data.buyer.city, data.buyer.state, data.buyer.pincode]
      .filter(Boolean)
      .join(', '),
  ]
    .filter(Boolean)
    .join(', ');

  const amountWords =
    data.amountInWords || amountInWordsIndian(Number(data.grandTotal || 0));

  return (
    <div
      id={id}
      className={`bg-white p-6 sm:p-10 text-slate-800 text-xs leading-relaxed font-sans shadow-sm border border-slate-200/90 rounded-2xl ${className}`}
      style={{ minHeight: '297mm', boxSizing: 'border-box' }}
    >
      {/* 1. Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b-2 border-slate-900 pb-6">
        <div>
          <div className="flex items-center gap-3">
            {data.seller.logoUrl ? (
              <img
                src={data.seller.logoUrl}
                alt={sellerName}
                className="h-10 w-auto max-w-[140px] object-contain rounded-md"
              />
            ) : (
              <span className="grid place-items-center h-9 w-9 rounded-xl bg-violet-700 text-white font-black text-base shadow-sm">
                {initial}
              </span>
            )}
            <span className="text-2xl font-black tracking-tight text-slate-900">
              {sellerName}
            </span>
          </div>

          {data.seller.companyName && data.seller.companyName !== data.seller.name && (
            <p className="mt-1 text-[13px] font-extrabold text-slate-900">
              {data.seller.companyName}
            </p>
          )}

          {sellerAddress && (
            <p className="mt-1 text-[11px] text-slate-600 max-w-sm whitespace-pre-line leading-snug">
              {sellerAddress}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500 font-medium">
            {data.seller.gstin && (
              <span>
                <strong className="text-slate-700">GSTIN:</strong>{' '}
                <span className="font-mono font-bold text-slate-800">{data.seller.gstin}</span>
              </span>
            )}
            {data.seller.pan && (
              <span>
                <strong className="text-slate-700">PAN:</strong>{' '}
                <span className="font-mono">{data.seller.pan}</span>
              </span>
            )}
            {data.seller.cin && (
              <span>
                <strong className="text-slate-700">CIN:</strong>{' '}
                <span className="font-mono">{data.seller.cin}</span>
              </span>
            )}
          </div>

          {(data.seller.email || data.seller.phone) && (
            <p className="mt-1 text-[10px] text-slate-500">
              {data.seller.email && (
                <>
                  Support:{' '}
                  <span className="font-medium text-slate-700">{data.seller.email}</span>
                </>
              )}
              {data.seller.email && data.seller.phone && ' | '}
              {data.seller.phone && (
                <>
                  Phone:{' '}
                  <span className="font-medium text-slate-700">{data.seller.phone}</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Document Meta Heading */}
        <div className="text-left sm:text-right shrink-0">
          <div className="inline-block rounded-lg bg-slate-100 border border-slate-300 px-3.5 py-1.5 text-center shadow-xs">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-900">
              {titles.header}
            </span>
            <p className="text-[9px] font-bold text-violet-700 tracking-wide">
              {titles.sub}
            </p>
          </div>

          <div className="mt-3 space-y-1 font-mono text-[11px]">
            <p>
              <span className="text-slate-500 font-sans">Number:</span>{' '}
              <strong className="text-slate-900 text-xs font-mono font-bold">
                {data.documentNumber}
              </strong>
            </p>
            <p>
              <span className="text-slate-500 font-sans">Date:</span>{' '}
              <span className="text-slate-900 font-semibold">{data.date}</span>
            </p>
            {data.dueDate && (
              <p>
                <span className="text-slate-500 font-sans">Due Date:</span>{' '}
                <span className="text-slate-900 font-semibold">{data.dueDate}</span>
              </p>
            )}
            <p>
              <span className="text-slate-500 font-sans">Place of Supply:</span>{' '}
              <span className="text-slate-900 font-semibold">
                {data.placeOfSupply || 'Uttar Pradesh (09)'}
              </span>
            </p>
            <p>
              <span className="text-slate-500 font-sans">Supply Type:</span>{' '}
              <span className="text-slate-900 font-semibold">
                {data.supplyType ||
                  (data.igstAmount && Number(data.igstAmount) > 0
                    ? 'Inter-State (IGST)'
                    : 'Intra-State (CGST + SGST)')}
              </span>
            </p>
            <p>
              <span className="text-slate-500 font-sans">Reverse Charge:</span>{' '}
              <span className="text-slate-900 font-semibold">
                {data.reverseCharge || 'No'}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* 2. Billed Details & Fulfillment Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-6 p-4 rounded-xl bg-slate-50/70 border border-slate-200/80">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <Building2 className="h-3 w-3 text-slate-400" />
            {isPurchase ? 'BILLED TO (BUYER DETAILS)' : 'BILLED TO (CUSTOMER DETAILS)'}
          </p>
          <p className="text-sm font-extrabold text-slate-900">
            {buyerName}
          </p>
          {data.buyer.gstin && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-50 border border-violet-200 text-[10px] font-mono font-bold text-violet-800">
                GSTIN: {data.buyer.gstin}
              </span>
              {data.buyer.pan && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-medium text-slate-700">
                  PAN: {data.buyer.pan}
                </span>
              )}
            </div>
          )}
          {data.buyer.email && (
            <p className="text-slate-600 text-[11px] mt-1">{data.buyer.email}</p>
          )}
          {data.buyer.phone && (
            <p className="text-slate-600 text-[11px]">{data.buyer.phone}</p>
          )}
          {buyerAddress && (
            <p className="text-slate-600 text-[11px] mt-1">{buyerAddress}</p>
          )}
        </div>

        {/* Payment & Fulfillment Side */}
        <div className="sm:border-l sm:border-slate-200 sm:pl-6 space-y-1 text-[11px]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-slate-400" /> Payment &amp; Terms
          </p>
          {data.orderRef && (
            <p className="flex justify-between sm:justify-start sm:gap-4">
              <span className="text-slate-500 w-28">Ref No:</span>
              <strong className="font-mono text-slate-900 font-semibold">
                {data.orderRef}
              </strong>
            </p>
          )}
          <p className="flex justify-between sm:justify-start sm:gap-4">
            <span className="text-slate-500 w-28">Payment Mode:</span>
            <span className="text-slate-900 font-semibold">
              {data.paymentMode || 'Bank / UPI / Credit'}
            </span>
          </p>
          {data.paymentStatus && (
            <p className="flex justify-between sm:justify-start sm:gap-4">
              <span className="text-slate-500 w-28">Status:</span>
              <span className="text-slate-900 font-semibold uppercase">
                {data.paymentStatus}
              </span>
            </p>
          )}
          {data.bankDetails?.bankName && !isPurchase && (
            <div className="pt-1.5 text-[10px] space-y-0.5 border-t border-slate-200 mt-2">
              <p className="text-slate-500 font-bold uppercase">Bank Account Details:</p>
              <p>
                <span className="text-slate-500">Bank:</span>{' '}
                <span className="font-medium text-slate-800">{data.bankDetails.bankName}</span>
              </p>
              {data.bankDetails.accountName && (
                <p>
                  <span className="text-slate-500">A/C Name:</span>{' '}
                  <span className="font-medium text-slate-800">{data.bankDetails.accountName}</span>
                </p>
              )}
              {data.bankDetails.accountNumber && (
                <p>
                  <span className="text-slate-500">A/C:</span>{' '}
                  <span className="font-mono font-medium text-slate-800">{data.bankDetails.accountNumber}</span>
                </p>
              )}
              {data.bankDetails.ifsc && (
                <p>
                  <span className="text-slate-500">IFSC:</span>{' '}
                  <span className="font-mono font-medium text-slate-800">{data.bankDetails.ifsc}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Line Items Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 mb-6">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
              <th className="px-3 py-2.5 w-10 text-center">#</th>
              <th className="px-3 py-2.5">Item Description</th>
              <th className="px-3 py-2.5 w-24 text-center">HSN/SAC</th>
              <th className="px-3 py-2.5 w-16 text-center">Qty</th>
              <th className="px-3 py-2.5 w-24 text-right">Unit Rate (₹)</th>
              <th className="px-3 py-2.5 w-20 text-center">Tax (GST)</th>
              <th className="px-3 py-2.5 w-28 text-right">Total (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((item, idx) => (
              <tr key={item.id ?? idx} className="hover:bg-slate-50/40">
                <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-400">
                  {idx + 1}
                </td>
                <td className="px-3 py-3">
                  <p className="font-bold text-slate-900">{item.name}</p>
                </td>
                <td className="px-3 py-3 text-center font-mono text-[11px] text-slate-500">
                  {item.hsnSac || '—'}
                </td>
                <td className="px-3 py-3 text-center font-mono font-semibold text-slate-700">
                  {item.quantity} {item.unit || ''}
                </td>
                <td className="px-3 py-3 text-right font-mono text-slate-700">
                  ₹{Number(item.rate || 0).toFixed(2)}
                </td>
                <td className="px-3 py-3 text-center text-[10px] font-semibold text-slate-500">
                  {item.taxRate !== undefined ? `${item.taxRate}%` : '0%'}
                </td>
                <td className="px-3 py-3 text-right font-mono font-bold text-slate-900">
                  ₹{Number(item.total || 0).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 4. Financial Totals & In-Words */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-6 border-b border-slate-200">
        <div className="flex flex-col justify-between space-y-4">
          <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/70">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Amount Chargeable (in words)
            </p>
            <p className="text-xs font-extrabold text-slate-900 italic">
              {amountWords || 'Indian Rupees Only'}
            </p>
          </div>
          {data.taxNote && (
            <div className="text-[10px] text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">Tax Note:</p>
              <p>{data.taxNote}</p>
            </div>
          )}
          {data.notes && (
            <div className="text-[10px] text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">Notes:</p>
              <p className="whitespace-pre-line">{data.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between py-1 text-slate-600">
            <span className="font-sans">Subtotal (Taxable Value):</span>
            <span>₹{Number(data.subtotal || 0).toFixed(2)}</span>
          </div>
          {data.cgstAmount !== undefined && Number(data.cgstAmount) > 0 && (
            <div className="flex justify-between py-1 text-slate-500">
              <span className="font-sans">Central GST (CGST):</span>
              <span>₹{Number(data.cgstAmount).toFixed(2)}</span>
            </div>
          )}
          {data.sgstAmount !== undefined && Number(data.sgstAmount) > 0 && (
            <div className="flex justify-between py-1 text-slate-500">
              <span className="font-sans">State GST (SGST):</span>
              <span>₹{Number(data.sgstAmount).toFixed(2)}</span>
            </div>
          )}
          {data.igstAmount !== undefined && Number(data.igstAmount) > 0 && (
            <div className="flex justify-between py-1 text-slate-500">
              <span className="font-sans">Integrated GST (IGST):</span>
              <span>₹{Number(data.igstAmount).toFixed(2)}</span>
            </div>
          )}
          {data.discount !== undefined && Number(data.discount) > 0 ? (
            <div className="flex justify-between py-1 text-emerald-600 font-semibold">
              <span className="font-sans">Discount:</span>
              <span>- ₹{Number(data.discount).toFixed(2)}</span>
            </div>
          ) : null}
          {data.roundOff !== undefined && Number(data.roundOff) !== 0 ? (
            <div className="flex justify-between py-1 text-slate-500">
              <span className="font-sans">Round Off:</span>
              <span>
                {Number(data.roundOff) > 0 ? '+ ' : '- '}₹{Math.abs(Number(data.roundOff)).toFixed(2)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between items-center rounded-xl bg-violet-50/70 border border-violet-200 p-3 font-sans mt-3">
            <span className="text-sm font-black text-violet-950">Grand Total (INR):</span>
            <span className="text-base font-black font-mono text-violet-900">
              ₹{Number(data.grandTotal || 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Footer & Signatory */}
      <div className="flex flex-col sm:flex-row justify-between items-end gap-6 pt-6">
        <div className="text-[10px] text-slate-500 space-y-1 max-w-md">
          <p className="font-bold text-slate-700">Terms &amp; Conditions:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {data.terms && data.terms.length > 0 ? (
              data.terms.map((term, i) => <li key={i}>{term}</li>)
            ) : (
              <>
                <li>Goods once sold will not be taken back or exchanged.</li>
                <li>Redemption / delivery is subject to agreed operational timelines.</li>
                <li>
                  This is a computer-generated document and requires no physical signature.
                </li>
              </>
            )}
          </ul>
        </div>

        <div className="text-center sm:text-right shrink-0">
          <div className="inline-block rounded-xl border border-dashed border-slate-300 p-3 bg-slate-50/50 text-center min-w-[200px]">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
              For {sellerName}
            </p>
            <div className="my-2 flex items-center justify-center gap-1 text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              <span className="text-[10px] font-black uppercase tracking-wider">
                DIGITALLY AUTHORIZED
              </span>
            </div>
            <p className="border-t border-slate-200 pt-1 text-[10px] font-bold text-slate-800">
              Authorized Signatory
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// Adapter Mappings: Convert DB records to UniversalDocumentData
// ==========================================

export function mapSalesInvoiceToUniversalData(
  business: any,
  invoice: any,
  items: any[] = []
): UniversalDocumentData {
  const isInterState =
    Number(invoice.igst_amount || 0) > 0 ||
    (invoice.place_of_supply &&
      business?.state &&
      invoice.place_of_supply !== business.state);

  const customer = invoice.customer || {};

  return {
    documentType: 'TAX_INVOICE',
    documentNumber: invoice.invoice_number || 'INV-000',
    date: formatDate(invoice.invoice_date || new Date().toISOString()),
    dueDate: invoice.due_date ? formatDate(invoice.due_date) : undefined,
    status: invoice.status,
    placeOfSupply: invoice.place_of_supply || business?.state || 'Uttar Pradesh (09)',
    supplyType: isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)',
    reverseCharge: 'No',
    orderRef: invoice.reference_number || invoice.order_number,
    paymentMode: invoice.payment_mode || 'Bank / UPI / Credit',
    paymentStatus: invoice.payment_status || 'unpaid',
    seller: {
      name: business?.name || 'Company',
      companyName: business?.legal_name || business?.name || 'Company',
      address: business?.address,
      city: business?.city,
      state: business?.state,
      pincode: business?.pincode,
      gstin: business?.gstin,
      pan:
        business?.pan ||
        (String(business?.gstin || '').length >= 12
          ? String(business.gstin).slice(2, 12)
          : undefined),
      cin: business?.cin,
      email: business?.email,
      phone: business?.phone,
      logoUrl: business?.logo_url || business?.stamp_url,
    },
    buyer: {
      name: customer.name || 'Customer',
      companyName: customer.company_name || customer.name || 'Customer',
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      gstin: customer.gstin,
      pan:
        customer.pan ||
        (String(customer.gstin || '').length >= 12
          ? String(customer.gstin).slice(2, 12)
          : undefined),
      email: customer.email,
      phone: customer.phone,
    },
    items: items.map((it, idx) => ({
      id: it.id || String(idx),
      name: it.product_name || it.item_name || 'Line Item',
      hsnSac: it.hsn_sac || it.hsnSac || '—',
      quantity: Number(it.quantity || 1),
      rate: Number(it.rate || it.unit_price || 0),
      discount: Number(it.discount_amount || it.discount || 0),
      taxRate: Number(it.tax_rate || 0),
      taxAmount:
        Number(it.cgst_amount || 0) +
        Number(it.sgst_amount || 0) +
        Number(it.igst_amount || 0),
      total: Number(it.total_amount || it.total || 0),
      unit: it.unit || 'PCS',
    })),
    subtotal: Number(invoice.taxable_amount ?? invoice.subtotal ?? 0),
    cgstAmount: Number(invoice.cgst_amount || 0),
    sgstAmount: Number(invoice.sgst_amount || 0),
    igstAmount: Number(invoice.igst_amount || 0),
    discount: Number(invoice.discount_amount || 0),
    roundOff: Number(invoice.round_off || 0),
    grandTotal: Number(invoice.grand_total || 0),
    amountInWords: amountInWordsIndian(Number(invoice.grand_total || 0)),
    bankDetails: {
      bankName: business?.bank_name,
      accountName:
        business?.account_name ||
        business?.bank_account_name ||
        business?.legal_name ||
        business?.name,
      accountNumber: business?.bank_account_number,
      ifsc: business?.bank_ifsc_code,
    },
    terms: invoice.terms
      ? invoice.terms.split('\n').map((t: string) => t.trim()).filter(Boolean)
      : undefined,
    notes: invoice.notes,
  };
}

export function mapQuotationToUniversalData(
  business: any,
  quote: any,
  items: any[] = []
): UniversalDocumentData {
  const isInterState = Number(quote.igst_amount || 0) > 0;
  const customer = quote.customer || {};

  return {
    documentType: 'QUOTATION',
    documentNumber: quote.quotation_number || 'QT-000',
    date: formatDate(quote.quote_date || new Date().toISOString()),
    dueDate: quote.expiry_date ? formatDate(quote.expiry_date) : undefined,
    status: quote.status,
    placeOfSupply: business?.state || 'Uttar Pradesh (09)',
    supplyType: isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)',
    reverseCharge: 'No',
    seller: {
      name: business?.name || 'Company',
      companyName: business?.legal_name || business?.name || 'Company',
      address: business?.address,
      city: business?.city,
      state: business?.state,
      pincode: business?.pincode,
      gstin: business?.gstin,
      pan:
        business?.pan ||
        (String(business?.gstin || '').length >= 12
          ? String(business.gstin).slice(2, 12)
          : undefined),
      cin: business?.cin,
      email: business?.email,
      phone: business?.phone,
      logoUrl: business?.logo_url || business?.stamp_url,
    },
    buyer: {
      name: customer.name || 'Customer',
      companyName: customer.company_name || customer.name || 'Customer',
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      gstin: customer.gstin,
      pan: customer.pan,
      email: customer.email,
      phone: customer.phone,
    },
    items: items.map((it, idx) => ({
      id: it.id || String(idx),
      name: it.product_name || it.item_name || 'Item',
      hsnSac: it.hsn_sac || '—',
      quantity: Number(it.quantity || 1),
      rate: Number(it.rate || 0),
      taxRate: Number(it.tax_rate || 0),
      total: Number(it.total_amount || 0),
      unit: it.unit || 'PCS',
    })),
    subtotal: Number(quote.taxable_amount ?? quote.subtotal ?? 0),
    cgstAmount: Number(quote.cgst_amount || 0),
    sgstAmount: Number(quote.sgst_amount || 0),
    igstAmount: Number(quote.igst_amount || 0),
    roundOff: Number(quote.round_off || 0),
    grandTotal: Number(quote.grand_total || 0),
    amountInWords: amountInWordsIndian(Number(quote.grand_total || 0)),
    bankDetails: {
      bankName: business?.bank_name,
      accountName:
        business?.account_name ||
        business?.bank_account_name ||
        business?.name,
      accountNumber: business?.bank_account_number,
      ifsc: business?.bank_ifsc_code,
    },
    terms: quote.terms
      ? quote.terms.split('\n').map((t: string) => t.trim()).filter(Boolean)
      : undefined,
    notes: quote.notes,
  };
}

export function mapSalesOrderToUniversalData(
  business: any,
  order: any,
  items: any[] = []
): UniversalDocumentData {
  const isInterState = Number(order.igst_amount || 0) > 0;
  const customer = order.customer || {};

  return {
    documentType: 'SALES_ORDER',
    documentNumber: order.order_number || 'SO-000',
    date: formatDate(order.order_date || new Date().toISOString()),
    dueDate: order.expected_delivery_date
      ? formatDate(order.expected_delivery_date)
      : undefined,
    status: order.status,
    placeOfSupply: business?.state || 'Uttar Pradesh (09)',
    supplyType: isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)',
    reverseCharge: 'No',
    orderRef: order.reference_number,
    seller: {
      name: business?.name || 'Company',
      companyName: business?.legal_name || business?.name || 'Company',
      address: business?.address,
      city: business?.city,
      state: business?.state,
      pincode: business?.pincode,
      gstin: business?.gstin,
      pan: business?.pan,
      cin: business?.cin,
      email: business?.email,
      phone: business?.phone,
      logoUrl: business?.logo_url || business?.stamp_url,
    },
    buyer: {
      name: customer.name || 'Customer',
      companyName: customer.company_name || customer.name || 'Customer',
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      gstin: customer.gstin,
      pan: customer.pan,
      email: customer.email,
      phone: customer.phone,
    },
    items: items.map((it, idx) => ({
      id: it.id || String(idx),
      name: it.product_name || 'Item',
      hsnSac: it.hsn_sac || '—',
      quantity: Number(it.quantity || 1),
      rate: Number(it.rate || 0),
      taxRate: Number(it.tax_rate || 0),
      total: Number(it.total_amount || 0),
      unit: it.unit || 'PCS',
    })),
    subtotal: Number(order.taxable_amount ?? order.subtotal ?? 0),
    cgstAmount: Number(order.cgst_amount || 0),
    sgstAmount: Number(order.sgst_amount || 0),
    igstAmount: Number(order.igst_amount || 0),
    roundOff: Number(order.round_off || 0),
    grandTotal: Number(order.grand_total || 0),
    amountInWords: amountInWordsIndian(Number(order.grand_total || 0)),
    bankDetails: {
      bankName: business?.bank_name,
      accountName:
        business?.account_name ||
        business?.bank_account_name ||
        business?.name,
      accountNumber: business?.bank_account_number,
      ifsc: business?.bank_ifsc_code,
    },
    notes: order.notes,
  };
}

export function mapPurchaseBillToUniversalData(
  business: any,
  bill: any,
  items: any[] = []
): UniversalDocumentData {
  const isInterState = Number(bill.igst_amount || 0) > 0;
  const supplier = bill.supplier || {};

  // For Purchase Bills: Seller = Supplier, Buyer = our business
  return {
    documentType: 'PURCHASE_BILL',
    documentNumber: bill.bill_number || 'PB-000',
    date: formatDate(bill.bill_date || new Date().toISOString()),
    dueDate: bill.due_date ? formatDate(bill.due_date) : undefined,
    status: bill.status,
    placeOfSupply: business?.state || 'Uttar Pradesh (09)',
    supplyType: isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)',
    reverseCharge: 'No',
    orderRef: bill.reference_number || bill.purchase_order_id,
    paymentMode: bill.payment_mode || 'Bank Transfer',
    paymentStatus: bill.payment_status || (Number(bill.balance_amount) <= 0 ? 'paid' : 'due'),
    seller: {
      name: supplier.name || 'Vendor',
      companyName: supplier.company_name || supplier.name || 'Vendor',
      address: supplier.address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode,
      gstin: supplier.gstin,
      pan: supplier.pan,
      email: supplier.email,
      phone: supplier.phone,
    },
    buyer: {
      name: business?.name || 'Company',
      companyName: business?.legal_name || business?.name || 'Company',
      address: business?.address,
      city: business?.city,
      state: business?.state,
      pincode: business?.pincode,
      gstin: business?.gstin,
      pan:
        business?.pan ||
        (String(business?.gstin || '').length >= 12
          ? String(business.gstin).slice(2, 12)
          : undefined),
      cin: business?.cin,
      email: business?.email,
      phone: business?.phone,
    },
    items: items.map((it, idx) => ({
      id: it.id || String(idx),
      name: it.product_name || 'Item',
      hsnSac: it.hsn_sac || '—',
      quantity: Number(it.quantity || 1),
      rate: Number(it.rate || 0),
      taxRate: Number(it.tax_rate || 0),
      total: Number(it.total_amount || 0),
      unit: it.unit || 'PCS',
    })),
    subtotal: Number(bill.taxable_amount ?? bill.subtotal ?? 0),
    cgstAmount: Number(bill.cgst_amount || 0),
    sgstAmount: Number(bill.sgst_amount || 0),
    igstAmount: Number(bill.igst_amount || 0),
    roundOff: Number(bill.round_off || 0),
    grandTotal: Number(bill.grand_total || 0),
    amountInWords: amountInWordsIndian(Number(bill.grand_total || 0)),
    // Bank details hidden on purchase bills per protocol
    notes: bill.notes,
  };
}

export function mapPurchaseOrderToUniversalData(
  business: any,
  order: any,
  items: any[] = []
): UniversalDocumentData {
  const isInterState = Number(order.igst_amount || 0) > 0;
  const supplier = order.supplier || {};

  // For Purchase Orders: Seller = Supplier, Buyer = our business
  return {
    documentType: 'PURCHASE_ORDER',
    documentNumber: order.order_number || 'PO-000',
    date: formatDate(order.order_date || new Date().toISOString()),
    dueDate: order.expected_delivery_date
      ? formatDate(order.expected_delivery_date)
      : undefined,
    status: order.status,
    placeOfSupply: business?.state || 'Uttar Pradesh (09)',
    supplyType: isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)',
    reverseCharge: 'No',
    orderRef: order.reference_number,
    seller: {
      name: supplier.name || 'Vendor',
      companyName: supplier.company_name || supplier.name || 'Vendor',
      address: supplier.address,
      city: supplier.city,
      state: supplier.state,
      pincode: supplier.pincode,
      gstin: supplier.gstin,
      pan: supplier.pan,
      email: supplier.email,
      phone: supplier.phone,
    },
    buyer: {
      name: business?.name || 'Company',
      companyName: business?.legal_name || business?.name || 'Company',
      address: business?.address,
      city: business?.city,
      state: business?.state,
      pincode: business?.pincode,
      gstin: business?.gstin,
      pan: business?.pan,
      cin: business?.cin,
      email: business?.email,
      phone: business?.phone,
    },
    items: items.map((it, idx) => ({
      id: it.id || String(idx),
      name: it.product_name || 'Item',
      hsnSac: it.hsn_sac || '—',
      quantity: Number(it.quantity || 1),
      rate: Number(it.rate || 0),
      taxRate: Number(it.tax_rate || 0),
      total: Number(it.total_amount || 0),
      unit: it.unit || 'PCS',
    })),
    subtotal: Number(order.taxable_amount ?? order.subtotal ?? 0),
    cgstAmount: Number(order.cgst_amount || 0),
    sgstAmount: Number(order.sgst_amount || 0),
    igstAmount: Number(order.igst_amount || 0),
    roundOff: Number(order.round_off || 0),
    grandTotal: Number(order.grand_total || 0),
    amountInWords: amountInWordsIndian(Number(order.grand_total || 0)),
    notes: order.notes,
  };
}
