import { formatCurrency, formatDate, amountInWordsIndian } from '@/lib/utils';
import type { Payment } from '@/types/db';

export interface PaymentReceiptParty {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  gstin?: string | null;
}

export interface PaymentReceiptBusiness {
  id?: string;
  name?: string | null;
  currency_symbol?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
}

export type PaymentReceiptData = Omit<Partial<Payment>, 'payment_method' | 'customer' | 'invoice'> & {
  id: string;
  payment_number: string;
  date: string;
  amount: number;
  allocated_amount?: number;
  payment_method?: string;
  reference?: string | null;
  notes?: string | null;
  customer?: PaymentReceiptParty | null;
  invoice?: { invoice_number: string } | null;
};

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RECEIPT_STYLES = `
  @page {
    size: A4 portrait;
    margin: 12mm;
  }
  *, *::before, *::after {
    box-sizing: border-box !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff !important;
    color: #0f172a !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .receipt-card {
    max-width: 680px;
    margin: 20px auto;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 30px 34px;
    background: #ffffff;
  }
  .receipt-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 18px;
    margin-bottom: 22px;
  }
  .biz-name {
    font-size: 19px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.4px;
  }
  .biz-meta {
    font-size: 10.5px;
    color: #475569;
    line-height: 1.5;
  }
  .doc-badge {
    text-align: right;
  }
  .badge-title {
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #0f172a;
  }
  .badge-item {
    font-size: 11px;
    color: #334155;
    margin-top: 3px;
  }
  .badge-item strong {
    color: #0f172a;
    font-weight: 700;
  }
  .party-section {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 22px;
  }
  .party-label {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 4px;
  }
  .party-name {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
  }
  .party-item {
    font-size: 11px;
    color: #475569;
    margin-top: 2px;
  }
  .receipt-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 22px;
    font-size: 12px;
  }
  .receipt-table thead th {
    background: #f1f5f9;
    border-bottom: 2px solid #cbd5e1;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
    padding: 9px 10px;
    font-family: inherit;
  }
  .receipt-table thead th.text-right {
    text-align: right;
  }
  .receipt-table tbody td {
    border-bottom: 1px solid #e2e8f0;
    padding: 9px 10px;
    color: #0f172a;
    vertical-align: top;
  }
  .receipt-table tbody td.text-right {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .receipt-table tbody td.bold {
    font-weight: 700;
  }
  .receipt-table tbody tr:last-child td {
    border-bottom: none;
  }
  .summary-card {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 24px;
  }
  .summary {
    min-width: 210px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    background: #f8fafc;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #334155;
    margin: 3px 0;
    line-height: 1.4;
  }
  .summary-row .label {
    color: #64748b;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-weight: 700;
  }
  .summary-row .value {
    font-weight: 700;
    color: #0f172a;
  }
  .summary-row.total .value {
    font-size: 13px;
  }
  .receipt-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 30px;
    padding-top: 18px;
    border-top: 1px dashed #cbd5e1;
  }
  .footer-note p {
    margin: 0 0 3px 0;
    font-size: 11.5px;
    color: #475569;
  }
  .footer-note p.muted {
    font-size: 10px;
    color: #94a3b8;
    font-weight: 500;
  }
  .sign-area {
    text-align: right;
  }
  .sign-for {
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 6px;
  }
  .sign-line {
    border-top: 1px solid #64748b;
    width: 170px;
    margin: 0 auto 4px;
  }
  .sign-title {
    font-size: 10px;
    font-weight: 700;
    color: #1e293b;
  }
`;

export function generateReceiptHtml(
  payment: PaymentReceiptData,
  business: PaymentReceiptBusiness | null | undefined
): string {
  const sym = business?.currency_symbol || '₹';
  const bizName = business?.name || 'AccountX Business';

  const bizAddress = [
    business?.address,
    [business?.city, business?.state].filter(Boolean).join(', '),
    business?.pincode ? `- ${business.pincode}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const bizContact = [
    business?.phone ? `Phone: ${business.phone}` : '',
    business?.email ? `Email: ${business.email}` : '',
    business?.gstin ? `GSTIN: ${business.gstin}` : '',
    business?.pan ? `PAN: ${business.pan}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const custName = payment.customer?.name || 'Customer';
  const custContact = [
    payment.customer?.phone ? `Phone: ${payment.customer.phone}` : '',
    payment.customer?.email ? `Email: ${payment.customer.email}` : '',
  ]
    .filter(Boolean)
    .join(' | ');
  const custGstin = payment.customer?.gstin ? `GSTIN: ${payment.customer.gstin}` : '';
  const custAddress = payment.customer?.address || '';

  const amount = Number(payment.amount) || 0;
  const allocated = Number(payment.allocated_amount) || 0;
  const unapplied = Math.max(0, amount - allocated);
  const methodLabel = (payment.payment_method || 'cash').toUpperCase().replace('_', ' ');
  const amountInWords = amountInWordsIndian(amount);

  return `
    <div class="receipt-card">
      <div class="receipt-header">
        <div class="biz-info">
          <div class="biz-name">${escapeHtml(bizName)}</div>
          ${bizAddress ? `<div class="biz-meta">${escapeHtml(bizAddress)}</div>` : ''}
          ${bizContact ? `<div class="biz-meta">${escapeHtml(bizContact)}</div>` : ''}
        </div>
        <div class="doc-badge">
          <div class="badge-title">PAYMENT RECEIPT</div>
          <div class="badge-item">Receipt No: <strong>${escapeHtml(payment.payment_number)}</strong></div>
          <div class="badge-item">Date: <strong>${escapeHtml(formatDate(payment.date))}</strong></div>
          <div class="badge-item">Payment Mode: <strong>${escapeHtml(methodLabel)}</strong></div>
        </div>
      </div>

      <div class="party-section">
        <div class="party-label">Received From</div>
        <div class="party-name">${escapeHtml(custName)}</div>
        ${custContact ? `<div class="party-item">${escapeHtml(custContact)}</div>` : ''}
        ${custGstin ? `<div class="party-item">${escapeHtml(custGstin)}</div>` : ''}
        ${custAddress ? `<div class="party-item">${escapeHtml(custAddress)}</div>` : ''}
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th style="width: 4%">#</th>
            <th>Description / Particulars</th>
            <th style="width: 17%">Payment Mode</th>
            <th class="text-right" style="width: 20%">Reference / Tran ID</th>
            <th class="text-right" style="width: 18%">Amount Received (INR)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-center">1</td>
            <td>
              ${payment.invoice?.invoice_number
                ? `Payment received against Invoice ${escapeHtml(payment.invoice.invoice_number)}`
                : 'Payment received — On Account / Advance'}
              ${payment.notes ? `<div class="party-item" style="font-size:10px;color:#64748b;margin-top:4px;">${escapeHtml(payment.notes)}</div>` : ''}
            </td>
            <td>${escapeHtml(methodLabel)}</td>
            <td class="text-right">${payment.reference ? escapeHtml(payment.reference) : '—'}</td>
            <td class="text-right bold tabular-nums">${formatCurrency(amount, sym)}</td>
          </tr>
        </tbody>
      </table>

      <div class="summary-card">
        <div class="summary">
          <div class="summary-row total">
            <span class="label">Total Received</span>
            <span class="value">${formatCurrency(amount, sym)}</span>
          </div>
          <div class="summary-row">
            <span class="label">Amount in words</span>
            <span class="value">${escapeHtml(amountInWords)}</span>
          </div>
          <div class="summary-row">
            <span class="label">Applied to Invoices</span>
            <span class="value">${allocated > 0 ? formatCurrency(allocated, sym) : 'On Account / Advance'}</span>
          </div>
          <div class="summary-row">
            <span class="label">Remaining Balance / Unallocated</span>
            <span class="value">${unapplied > 0 ? formatCurrency(unapplied, sym) : '—'}</span>
          </div>
        </div>
      </div>

      <div class="receipt-footer">
        <div class="footer-note">
          <p>Thank you for your payment. This is a computer-generated receipt.</p>
          ${payment.notes ? `<p class="muted">Notes: ${escapeHtml(payment.notes)}</p>` : ''}
        </div>
        <div class="sign-area">
          <div class="sign-for">For ${escapeHtml(bizName)}</div>
          <div class="sign-line"></div>
          <div class="sign-title">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;
}

export function printPaymentReceipt(
  payment: PaymentReceiptData,
  business: PaymentReceiptBusiness | null | undefined
): void {
  const htmlContent = generateReceiptHtml(payment, business);

  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0px';
  printFrame.style.height = '0px';
  printFrame.style.border = 'none';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt ${escapeHtml(payment.payment_number)}</title>
        <style>
          ${RECEIPT_STYLES}
        </style>
      </head>
      <body>
        ${htmlContent}
        <script>
          const triggerPrint = () => {
            setTimeout(() => {
              window.focus();
              try {
                window.print();
              } catch (e) {
                console.warn('print error', e);
              }
              setTimeout(() => {
                if (window.frameElement && window.frameElement.parentNode) {
                  window.frameElement.parentNode.removeChild(window.frameElement);
                }
              }, 1500);
            }, 250);
          };
          if (document.readyState === 'complete') {
            triggerPrint();
          } else {
            window.addEventListener('load', triggerPrint);
          }
        <\/script>
      </body>
    </html>
  `);
  doc.close();

  // Trigger print and cleanup
  setTimeout(() => {
    try {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
    } catch {
      // Handled if inner script already printed or unsupported
    }
    setTimeout(() => {
      try {
        if (printFrame.parentNode) {
          printFrame.parentNode.removeChild(printFrame);
        }
      } catch {
        // Frame already removed
      }
    }, 1500);
  }, 350);
}
