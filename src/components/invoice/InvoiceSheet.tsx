import { QRCodeSVG } from 'qrcode.react';
import { formatCurrency, formatDate, formatNumber, amountInWordsIndian } from '@/lib/utils';
import { buildUpiUri } from '@/lib/upi';
import type { Business, SalesInvoice, SalesInvoiceItem, Customer } from '@/types/db';

export type InvoiceWithCustomer = SalesInvoice & { customer: Customer | null };

export { buildUpiUri };

type InvoiceSheetProps = {
  business: Business | null;
  invoice: InvoiceWithCustomer;
  items: SalesInvoiceItem[];
};

/**
 * Shared printable A4 GST tax-invoice document.
 * Light-only styling by design so browser print and PDF capture are theme-independent.
 * Reused by: SalesInvoiceViewPage (print/PDF source) and SalesInvoiceCreatePage (live preview).
 */
export function InvoiceSheet({ business, invoice, items }: InvoiceSheetProps) {
  const sym = business?.currency_symbol || '₹';
  const customer = invoice.customer;

  const isInterState =
    invoice.place_of_supply && business?.state
      ? invoice.place_of_supply !== business.state
      : Number(invoice.igst_amount) > 0;

  const hasCess = items.some((it) => Number(it.cess_amount) > 0);
  const upiUri = buildUpiUri(business, Number(invoice.grand_total));
  // Forward-compatible stamp/signature slot: renders when a Business Settings
  // image URL (stamp_url) exists; styled manual-stamp placeholder otherwise.
  const stampUrl = (business as (Business & { stamp_url?: string | null }) | null)?.stamp_url ?? null;
  const signatureUrl = (business as (Business & { signature_url?: string | null }) | null)?.signature_url ?? null;
  const bankName = business?.bank_name ?? null;
  const bankAccount = business?.bank_account_number ?? null;
  const upiId = business?.upi_id ?? null;
  const footerText = business?.invoice_footer_text?.trim() || null;
  const signatureName = business?.invoice_signature_name?.trim() || null;

  return (
    <div className="bg-white text-secondary-900 rounded-xl border border-secondary-200 shadow-card">
      {/* Seller / meta header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 px-6 py-5 border-b border-secondary-200">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">{business?.legal_name || business?.name || '—'}</h1>
          {business && (
            <p className="text-xs text-secondary-500 mt-1 whitespace-pre-line">
              {[business.address, [business.city, business.state].filter(Boolean).join(', ')].filter(Boolean).join('\n')}
            </p>
          )}
          <p className="text-xs text-secondary-500 mt-1">
            {business?.gstin ? <>GSTIN: <span className="font-mono font-medium text-secondary-700">{business.gstin}</span></> : null}
            {business?.gstin && business?.pan ? ' • ' : ''}
            {business?.pan ? <>PAN: <span className="font-mono">{business.pan}</span></> : null}
          </p>
          {business?.phone && <p className="text-xs text-secondary-500">Phone: {business.phone}</p>}
          {business?.email && <p className="text-xs text-secondary-500">{business.email}</p>}
        </div>
        <div className="sm:text-right shrink-0">
          <h2 className="text-base font-bold tracking-wide uppercase">Tax Invoice</h2>
          <table className="mt-2 text-xs">
            <tbody>
              <tr>
                <td className="text-secondary-500 pr-3 py-0.5">Invoice No.</td>
                <td className="font-mono font-semibold py-0.5">{invoice.invoice_number}</td>
              </tr>
              <tr>
                <td className="text-secondary-500 pr-3 py-0.5">Invoice Date</td>
                <td className="py-0.5">{formatDate(invoice.invoice_date)}</td>
              </tr>
              {invoice.due_date && (
                <tr>
                  <td className="text-secondary-500 pr-3 py-0.5">Due Date</td>
                  <td className="py-0.5">{formatDate(invoice.due_date)}</td>
                </tr>
              )}
              <tr>
                <td className="text-secondary-500 pr-3 py-0.5">Place of Supply</td>
                <td className="py-0.5">{invoice.place_of_supply || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill To */}
      <div className="px-6 py-4 border-b border-secondary-200">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary-400 mb-1">Bill To</p>
        <p className="text-sm font-semibold">{customer?.company_name || customer?.name || '—'}</p>
        {customer?.company_name && customer?.name && <p className="text-xs text-secondary-600">{customer.name}</p>}
        {customer?.address && <p className="text-xs text-secondary-500 mt-0.5 whitespace-pre-line">{customer.address}</p>}
        <p className="text-xs text-secondary-500">
          {[customer?.city, customer?.state, customer?.pincode].filter(Boolean).join(', ')}
        </p>
        {(customer?.gstin || customer?.phone) && (
          <p className="text-xs text-secondary-500 mt-0.5">
            {customer?.gstin ? <>GSTIN: <span className="font-mono font-medium text-secondary-700">{customer.gstin}</span></> : null}
            {customer?.gstin && customer?.phone ? ' • ' : ''}
            {customer?.phone || ''}
          </p>
        )}
      </div>

      {/* Line items */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary-50 text-left text-secondary-500 border-b border-secondary-200">
              <th className="px-3 py-2 font-semibold w-8">#</th>
              <th className="px-3 py-2 font-semibold">Item &amp; HSN/SAC</th>
              <th className="px-3 py-2 font-semibold text-right">Qty</th>
              <th className="px-3 py-2 font-semibold text-right">Rate</th>
              <th className="px-3 py-2 font-semibold text-right">Disc</th>
              <th className="px-3 py-2 font-semibold text-right">Taxable</th>
              {isInterState ? (
                <th className="px-3 py-2 font-semibold text-right">IGST</th>
              ) : (
                <>
                  <th className="px-3 py-2 font-semibold text-right">CGST</th>
                  <th className="px-3 py-2 font-semibold text-right">SGST</th>
                </>
              )}
              {hasCess && <th className="px-3 py-2 font-semibold text-right">Cess</th>}
              <th className="px-3 py-2 font-semibold text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id} className="border-b border-secondary-100">
                <td className="px-3 py-2 text-secondary-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <p className="font-medium">{it.product_name}</p>
                  {it.hsn_sac && <p className="text-[10px] text-secondary-400 font-mono">HSN/SAC: {it.hsn_sac}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatNumber(Number(it.quantity))} {it.unit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(it.rate), sym)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(it.discount_amount) > 0 ? formatCurrency(Number(it.discount_amount), sym) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(it.taxable_amount), sym)}</td>
                {isInterState ? (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(it.igst_amount), sym)}
                    <span className="text-[10px] text-secondary-400"> ({Number(it.tax_rate)}%)</span>
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(it.cgst_amount), sym)}
                      <span className="text-[10px] text-secondary-400"> ({Number(it.tax_rate) / 2}%)</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(it.sgst_amount), sym)}
                      <span className="text-[10px] text-secondary-400"> ({Number(it.tax_rate) / 2}%)</span>
                    </td>
                  </>
                )}
                {hasCess && <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(it.cess_amount), sym)}</td>}
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(Number(it.total_amount), sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals + amount in words */}
      <div className="flex flex-col sm:flex-row justify-between gap-6 px-6 py-4 border-b border-secondary-200">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary-400 mb-1">Amount in Words</p>
          <p className="text-xs italic text-secondary-600">{amountInWordsIndian(Number(invoice.grand_total))}</p>
          {invoice.notes && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary-400 mt-4 mb-1">Notes</p>
              <p className="text-xs text-secondary-600 whitespace-pre-line">{invoice.notes}</p>
            </>
          )}
        </div>
        <div className="w-full sm:w-72 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-secondary-500">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(Number(invoice.subtotal), sym)}</span>
          </div>
          {Number(invoice.discount_amount) > 0 && (
            <div className="flex justify-between">
              <span className="text-secondary-500">Discount</span>
              <span className="tabular-nums">-{formatCurrency(Number(invoice.discount_amount), sym)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-secondary-500">Taxable Amount</span>
            <span className="tabular-nums">{formatCurrency(Number(invoice.taxable_amount), sym)}</span>
          </div>
          {isInterState ? (
            <div className="flex justify-between">
              <span className="text-secondary-500">IGST</span>
              <span className="tabular-nums">{formatCurrency(Number(invoice.igst_amount), sym)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-secondary-500">CGST</span>
                <span className="tabular-nums">{formatCurrency(Number(invoice.cgst_amount), sym)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary-500">SGST</span>
                <span className="tabular-nums">{formatCurrency(Number(invoice.sgst_amount), sym)}</span>
              </div>
            </>
          )}
          {Number(invoice.cess_amount) > 0 && (
            <div className="flex justify-between">
              <span className="text-secondary-500">Cess</span>
              <span className="tabular-nums">{formatCurrency(Number(invoice.cess_amount), sym)}</span>
            </div>
          )}
          {Number(invoice.round_off) !== 0 && (
            <div className="flex justify-between">
              <span className="text-secondary-500">Round Off</span>
              <span className="tabular-nums">{formatCurrency(Number(invoice.round_off), sym)}</span>
            </div>
          )}
          <div className="border-t border-secondary-300 pt-1.5 flex justify-between text-sm font-bold">
            <span>Grand Total</span>
            <span className="tabular-nums">{formatCurrency(Number(invoice.grand_total), sym)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary-500">Paid</span>
            <span className="tabular-nums">{formatCurrency(Number(invoice.paid_amount), sym)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Balance Due</span>
            <span className="tabular-nums">{formatCurrency(Number(invoice.balance_amount), sym)}</span>
          </div>
        </div>
      </div>

      {/* Footer: terms / UPI QR left — company stamp & signature right */}
      <div className="flex flex-col sm:flex-row justify-between gap-6 px-6 py-4">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            {upiUri && (
              <>
                <QRCodeSVG value={upiUri} size={56} level="M" />
                <p className="text-[10px] text-secondary-400 max-w-24 leading-tight">Scan to pay via UPI</p>
              </>
            )}
          </div>
          {(bankName || bankAccount || upiId) && (
            <div className="text-xs text-secondary-600">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary-400 mb-1">Bank Details</p>
              {bankName && <p>{bankName}</p>}
              {bankAccount && <p>A/c: <span className="font-mono">{bankAccount}</span></p>}
              {upiId && <p>UPI: <span className="font-mono">{upiId}</span></p>}
            </div>
          )}
          {invoice.terms && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-secondary-400 mb-1">Terms &amp; Conditions</p>
              <p className="text-xs text-secondary-600 whitespace-pre-line">{invoice.terms}</p>
            </>
          )}
        </div>
        <div className="sm:text-right shrink-0 pt-2">
          <p className="text-xs text-secondary-500">For <span className="font-semibold">{business?.legal_name || business?.name || '—'}</span></p>
          {signatureName && <p className="text-[11px] text-secondary-500 mt-0.5">{signatureName}</p>}
          <div className="relative h-20 w-48 mt-1.5 rounded-md border border-dashed border-secondary-300 bg-secondary-50/40 flex items-center justify-center overflow-hidden sm:ml-auto">
            {signatureUrl ? (
              <img
                src={signatureUrl}
                alt="Authorized signatory signature"
                className="max-h-16 max-w-[70%] object-contain absolute left-2 bottom-1"
              />
            ) : null}
            {stampUrl ? (
              <img
                src={stampUrl}
                alt="Company stamp / seal"
                className="max-h-16 max-w-[55%] object-contain absolute right-1 top-1 opacity-90 mix-blend-multiply"
              />
            ) : null}
            {!signatureUrl && !stampUrl && (
              <span className="text-[10px] text-secondary-300 px-3 text-center leading-tight">Affix company stamp / ink signature</span>
            )}
          </div>
          <p className="text-[11px] text-secondary-400 border-t border-secondary-200 pt-1 mt-1.5">Authorized Signatory / Proprietor</p>
        </div>
      </div>
      {footerText && (
        <p className="border-t border-secondary-200 px-6 py-2.5 text-center text-[10px] text-secondary-500 whitespace-pre-line">
          {footerText}
        </p>
      )}
    </div>
  );
}
