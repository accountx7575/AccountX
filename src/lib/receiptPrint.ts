import { formatCurrency, formatDate, amountInWordsIndian } from '@/lib/utils';
import { formatAadhaar } from '@/lib/validation';
import { extractBankDetails } from '@/lib/documentMappers';
import { resolveTermsLines, tncLines, STANDARD_TNC_DEFAULTS } from '@/lib/tncDefaults';
import type { Payment } from '@/types/db';

export interface PaymentReceiptParty {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  pin_code?: string | null;
  gstin?: string | null;
  pan?: string | null;
  aadhaar?: string | null;
  companyName?: string | null;
  company_name?: string | null;
  [key: string]: any;
}

export interface PaymentReceiptBusiness {
  id?: string;
  name?: string | null;
  legal_name?: string | null;
  legalName?: string | null;
  trade_name?: string | null;
  tradeName?: string | null;
  currency_symbol?: string | null;
  address?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  pinCode?: string | null;
  pin_code?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  logo_url?: string | null;
  logoUrl?: string | null;
  signature_url?: string | null;
  signatureUrl?: string | null;
  signature_name?: string | null;
  signatureName?: string | null;
  stamp_url?: string | null;
  stampUrl?: string | null;
  bank_name?: string | null;
  bankName?: string | null;
  bank_account_no?: string | null;
  bank_account_number?: string | null;
  accountNumber?: string | null;
  bank_ifsc?: string | null;
  bank_ifsc_code?: string | null;
  ifsc?: string | null;
  upi_id?: string | null;
  upiId?: string | null;
  account_name?: string | null;
  account_holder_name?: string | null;
  accountHolderName?: string | null;
  bankDetails?: {
    bankName?: string;
    accountNumber?: string;
    accountHolderName?: string;
    ifsc?: string;
    upiId?: string;
  };
  terms_payment_receipt?: string | null;
  termsPaymentReceipt?: string | null;
  tnc_payment_receipt?: string | null;
  [key: string]: any;
}

export type PaymentReceiptData = Omit<Partial<Payment>, 'payment_method' | 'customer' | 'invoice'> & {
  id: string;
  payment_number: string;
  date: string;
  created_at?: string;
  amount: number;
  allocated_amount?: number;
  payment_method?: string;
  reference?: string | null;
  notes?: string | null;
  customer?: PaymentReceiptParty | null;
  invoice?: { invoice_number: string } | null;
  [key: string]: any;
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

export function formatReceiptDateTime(dateVal?: string | null, createdAtVal?: string | null): string {
  let raw = createdAtVal;
  if (!raw || (typeof raw === 'string' && !raw.includes('T') && !raw.includes(' '))) {
    raw = dateVal && (dateVal.includes('T') || dateVal.includes(' ')) ? dateVal : createdAtVal || dateVal;
  }
  if (!raw) return '—';

  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const formattedHours = String(hours).padStart(2, '0');

  return `${day}/${month}/${year}, ${formattedHours}:${minutes} ${ampm}`;
}

export const RECEIPT_STYLES = `
  @page {
    size: A4 portrait;
    margin: 12mm 15mm;
  }
  @media print {
    *, *::before, *::after {
      box-sizing: border-box !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      color: #1e293b !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  }
  .receipt-container {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.5;
    color: #1e293b;
    background: #ffffff;
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 32px;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .receipt-container *,
  .receipt-container *::before,
  .receipt-container *::after {
    box-sizing: border-box;
  }
  .receipt-header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .receipt-header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 6px;
  }
  .biz-branding {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .biz-logo-img {
    height: 44px;
    width: auto;
    max-width: 180px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .biz-logo-badge {
    height: 36px;
    width: 36px;
    border-radius: 10px;
    background-color: #047857;
    color: #ffffff;
    display: grid;
    place-items: center;
    font-weight: 900;
    font-size: 16px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .biz-name-col {
    display: flex;
    flex-direction: column;
  }
  .biz-title {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.5px;
    color: #064e3b;
    line-height: 1.15;
  }
  .biz-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
  }
  .doc-badge {
    display: inline-block;
    border-radius: 6px;
    background-color: #ecfdf5;
    border: 1px solid #a7f3d0;
    padding: 4px 14px;
    text-align: center;
    flex-shrink: 0;
  }
  .badge-title {
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #064e3b;
    display: block;
  }
  .badge-subtitle {
    margin: 2px 0 0 0;
    font-size: 9px;
    font-weight: 600;
    color: #047857;
  }
  .header-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 1px 0;
    line-height: 1.35;
  }
  .header-col-left {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    line-height: 1.35;
    color: #475569;
    display: flex;
    align-items: baseline;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-col-left .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-left .val {
    color: #334155;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-left .val-mono {
    font-size: 11px;
    font-weight: 600;
  }
  .header-col-right {
    flex: 0 0 auto;
    text-align: right;
    display: flex;
    align-items: baseline;
    justify-content: flex-end;
    gap: 6px;
    font-size: 11px;
    line-height: 1.35;
    white-space: nowrap;
  }
  .header-col-right .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
  }
  .header-col-right .val {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
  }
  .header-col-right strong {
    color: #0f172a;
    font-size: 11.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 700;
  }
  .two-col-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    padding: 12px 18px;
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.7);
    border: 1px solid rgba(226, 232, 240, 0.8);
    margin-bottom: 16px;
  }
  .card-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .payment-details-col {
    border-left: 1px solid #e2e8f0;
    padding-left: 20px;
  }
  .card-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .card-icon {
    width: 13px;
    height: 13px;
    color: #94a3b8;
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
  .card-rows {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .card-row {
    display: flex;
    align-items: baseline;
    font-size: 11px;
    line-height: 1.35;
    padding: 1px 0;
    color: #475569;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    white-space: nowrap;
  }
  .card-party-name {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
  }
  .customer-card-col .card-row {
    color: #475569;
    font-weight: 400;
  }
  .customer-card-col .card-party-name {
    font-weight: 700 !important;
    color: #0f172a !important;
  }
  .customer-card-col .val,
  .customer-card-col .val-mono {
    font-weight: 400 !important;
    color: #475569 !important;
    font-size: 11px;
  }
  .customer-card-col .label {
    font-weight: 400 !important;
    color: #64748b !important;
    font-size: 11px;
  }
  .customer-card-col .pipe-sep {
    color: #cbd5e1;
    margin: 0 5px;
    font-weight: 400;
  }
  .customer-card-col .party-gstin-pill,
  .customer-card-col .party-pan-pill,
  .customer-card-col .party-aadhaar-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    font-size: 10.5px;
    line-height: 1.35;
    font-weight: 400;
    color: #475569;
  }
  .customer-card-col .party-gstin-pill .val-mono,
  .customer-card-col .party-pan-pill .val-mono,
  .customer-card-col .party-aadhaar-pill .val-mono {
    font-weight: 400 !important;
    color: #334155 !important;
    font-size: 10.5px;
  }
  .payment-details-col .card-row {
    color: #334155;
  }
  .payment-details-col .label {
    color: #64748b;
    font-weight: 500;
    font-size: 11px;
  }
  .payment-details-col .val-mono {
    color: #0f172a;
    font-weight: 600;
    font-size: 11px;
  }
  .pipe-sep {
    color: #cbd5e1;
    margin: 0 6px;
    font-weight: 400;
  }
  .label {
    color: #64748b;
    font-size: 11px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .val {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
  }
  .val-mono {
    color: #0f172a;
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .party-gstin-pill,
  .party-pan-pill,
  .party-aadhaar-pill {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: 11px;
    line-height: 1.35;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 700;
    background: #d1fae5;
    border: 1px solid #a7f3d0;
    color: #065f46;
  }
  .table-box {
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .receipt-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .receipt-table thead tr {
    background: rgba(241, 245, 249, 0.8);
    border-bottom: 1px solid #e2e8f0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #475569;
  }
  .receipt-table th {
    padding: 10px 12px;
    text-align: left;
  }
  .receipt-table th.text-center {
    text-align: center;
  }
  .receipt-table th.text-right {
    text-align: right;
  }
  .receipt-table td {
    padding: 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }
  .receipt-table td.text-center {
    text-align: center;
  }
  .receipt-table td.text-right {
    text-align: right;
  }
  .receipt-table tbody tr:last-child td {
    border-bottom: none;
  }
  .td-desc-title {
    font-weight: 700;
    color: #0f172a;
  }
  .td-desc-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
  }
  .td-desc-note {
    font-size: 10px;
    color: #64748b;
    margin-top: 3px;
    font-style: italic;
  }
  .num-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    padding-top: 6px;
    padding-bottom: 20px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 20px;
  }
  .words-card {
    border-radius: 10px;
    background: #f8fafc;
    padding: 12px 14px;
    border: 1px solid rgba(226, 232, 240, 0.7);
  }
  .words-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 4px;
  }
  .words-val {
    font-size: 11px;
    font-weight: 800;
    font-style: italic;
    color: #0f172a;
    line-height: 1.4;
  }
  .bank-details-card {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
  }
  .bank-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .bank-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
  }
  .bank-rows {
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bank-row {
    display: flex;
    align-items: baseline;
    line-height: 1.4;
    white-space: nowrap;
  }
  .bank-row span.label {
    color: #64748b;
    font-size: 10px;
    width: 65px;
    flex-shrink: 0;
    letter-spacing: 0.2px;
  }
  .bank-row span.val {
    font-weight: 600;
    color: #0f172a;
    font-size: 11px;
  }
  .bank-row span.val-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    color: #0f172a;
    font-size: 11px;
  }
  .totals-col {
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .total-line {
    display: flex;
    justify-content: space-between;
    color: #475569;
    padding: 2px 0;
  }
  .total-line span.val {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 600;
    color: #0f172a;
  }
  .grand-total-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 10px;
    background: rgba(236, 253, 245, 0.7);
    border: 1px solid #a7f3d0;
    padding: 10px 14px;
    margin-top: 8px;
  }
  .grand-total-label {
    font-size: 13px;
    font-weight: 900;
    color: #064e3b;
  }
  .grand-total-val {
    font-size: 16px;
    font-weight: 900;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #064e3b;
  }
  .receipt-footer-section {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    padding-top: 14px;
  }
  .terms-box {
    max-width: 440px;
    font-size: 10px;
    color: #64748b;
  }
  .terms-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #334155;
    margin-bottom: 4px;
  }
  .terms-content {
    line-height: 1.5;
  }
  .terms-content p {
    margin: 0 0 2px 0;
  }
  .signatory-box {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    min-width: 170px;
  }
  .signatory-for {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
    margin-bottom: 4px;
  }
  .sign-img {
    height: 48px;
    max-width: 130px;
    object-fit: contain;
    margin: 4px 0;
  }
  .sign-dashed {
    height: 48px;
    width: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed #cbd5e1;
    border-radius: 4px;
    margin: 4px 0;
  }
  .sign-dashed span {
    font-size: 9px;
    color: #94a3b8;
  }
  .sign-name {
    font-size: 11px;
    font-weight: 700;
    color: #1e293b;
    margin-top: 2px;
  }
  .sign-sub {
    font-size: 9px;
    color: #94a3b8;
  }
  .bottom-disclaimer {
    width: 100%;
    border-top: 1px solid #f1f5f9;
    padding-top: 8px;
    margin-top: 24px;
    text-align: center;
  }
  .bottom-disclaimer p {
    font-size: 9px;
    color: #94a3b8;
    letter-spacing: 0.4px;
    margin: 0;
  }
`;

export function generateReceiptHtml(
  payment: PaymentReceiptData,
  business: PaymentReceiptBusiness | null | undefined
): string {
  const sym = business?.currency_symbol || '₹';
  const bizName = business?.legal_name || business?.legalName || business?.name || 'Avadh Boring Company';
  const tradeName = String(business?.trade_name || business?.tradeName || '').trim();
  const showTradeSubtitle =
    tradeName.length > 0 && tradeName.toLowerCase() !== String(bizName).trim().toLowerCase();

  const logoLetter = (bizName || 'A').charAt(0).toUpperCase();
  const logoUrl = business?.logo_url || business?.logoUrl || business?.logo || null;

  const bizStreet = business?.address || business?.addressLine1 || '';
  const bizCityStatePin = [
    [business?.city, business?.state].filter(Boolean).join(', '),
    business?.pincode ? `- ${business.pincode}` : (business?.pin_code ? `- ${business.pin_code}` : ''),
  ]
    .filter(Boolean)
    .join(' ');

  const bizPhone = business?.phone || '';
  const bizEmail = business?.email || '';
  const bizGstin = business?.gstin || '';
  const bizPan = business?.pan || (bizGstin.length >= 12 ? bizGstin.slice(2, 12) : '');

  const signatureUrl = business?.signature_url || business?.signatureUrl || business?.stamp_url || business?.stampUrl || null;
  const signatureName = business?.signature_name || business?.signatureName || 'Authorized Signatory';

  const bankInfo = extractBankDetails(business);
  const bankName = bankInfo.bankName || business?.bank_name || business?.bankName || '';
  const accountHolder = bankInfo.accountHolderName || business?.account_name || business?.account_holder_name || business?.accountHolderName || '';
  const effectiveAccountHolder = accountHolder || bizName;
  const accountNo = bankInfo.accountNumber || business?.bank_account_no || business?.bank_account_number || business?.accountNumber || '';
  const ifsc = bankInfo.ifsc || business?.bank_ifsc || business?.bank_ifsc_code || business?.ifsc || '';
  const upiId = bankInfo.upiId || business?.upi_id || business?.upiId || '';

  const hasBankDetails = Boolean(bankName || accountNo || ifsc || upiId || accountHolder);

  const custName = payment.customer?.name || payment.customer?.company_name || (payment as any).customer_name || 'Customer';
  const custPhone = String(payment.customer?.phone || '').trim();
  const custEmail = String(payment.customer?.email || '').trim();
  const custAddress = String(payment.customer?.address || (payment.customer as any)?.street || '').trim();
  const custCity = String(payment.customer?.city || '').trim();
  const custState = String(payment.customer?.state || '').trim();
  const custPincode = String(payment.customer?.pincode || (payment.customer as any)?.pin_code || '').trim();
  const custGstin = String(payment.customer?.gstin || '').trim();
  const custPan = String(payment.customer?.pan || (custGstin.length >= 12 ? custGstin.slice(2, 12) : '')).trim();
  const custAadhaar = String(payment.customer?.aadhaar || '').trim();

  // Line 4: City, State - Pincode (e.g. "Barabanki, Uttar Pradesh - 225001")
  let cityStatePin = '';
  const cityState = [custCity, custState].filter(Boolean).join(', ');
  if (cityState && custPincode) {
    cityStatePin = `${cityState} - ${custPincode}`;
  } else if (cityState) {
    cityStatePin = cityState;
  } else if (custPincode) {
    cityStatePin = custPincode;
  }

  const amount = Number(payment.amount) || 0;
  const allocated = Number(payment.allocated_amount) || 0;
  const unapplied = Math.max(0, amount - allocated);
  const methodLabel = (payment.payment_method || 'cash').toUpperCase().replace('_', ' ');
  const amountInWords = amountInWordsIndian(amount);
  const receiptDateTimeStr = formatReceiptDateTime(payment.date, payment.created_at);

  const configuredTerms = resolveTermsLines('payment_receipt', business, (payment as any).terms);
  const termsList = configuredTerms.length > 0
    ? configuredTerms
    : tncLines(STANDARD_TNC_DEFAULTS.payment_receipt);

  return `
    <div class="receipt-container">
      <!-- 1. Header Section -->
      <div class="receipt-header">
        <div class="receipt-header-top">
          <div class="biz-branding">
            ${logoUrl ? `
              <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(bizName)}" class="biz-logo-img" />
            ` : `
              <span class="biz-logo-badge">${escapeHtml(logoLetter)}</span>
            `}
            <div class="biz-name-col">
              <span class="biz-title">${escapeHtml(bizName)}</span>
              ${showTradeSubtitle ? `<div class="biz-subtitle">${escapeHtml(tradeName)}</div>` : ''}
            </div>
          </div>

          <div class="doc-badge">
            <span class="badge-title">PAYMENT RECEIPT</span>
            <p class="badge-subtitle">Original for Recipient</p>
          </div>
        </div>

        <!-- Single-Row Pairs: Business Info (Left) | Receipt Metadata (Right) -->
        <div class="header-rows">
          <!-- Row 1: Street Address (Left) | Receipt No (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              <span>${escapeHtml(bizStreet || 'AN-25, Lautabagh, Azadnagar, Nawabganj')}</span>
            </div>
            <div class="header-col-right">
              <span class="label">Receipt No:</span>
              <strong>${escapeHtml(payment.payment_number)}</strong>
            </div>
          </div>

          <!-- Row 2: City, State - Pincode (Left) | Receipt Date & Time (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              <span>${escapeHtml(bizCityStatePin || 'Barabanki, Uttar Pradesh - 225001')}</span>
            </div>
            <div class="header-col-right">
              <span class="label">Receipt Date &amp; Time:</span>
              <span class="val">${escapeHtml(receiptDateTimeStr)}</span>
            </div>
          </div>

          <!-- Row 3: GSTIN | PAN (Left) | Payment Mode (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              ${(bizGstin || bizPan) ? `
                ${bizGstin ? `<span class="label">GSTIN:</span> <strong class="val-mono">${escapeHtml(bizGstin)}</strong>` : ''}
                ${bizGstin && bizPan ? `<span class="pipe-sep">|</span>` : ''}
                ${bizPan ? `<span class="label">PAN:</span> <strong class="val-mono">${escapeHtml(bizPan)}</strong>` : ''}
              ` : `<span>&nbsp;</span>`}
            </div>
            <div class="header-col-right">
              <span class="label">Payment Mode:</span>
              <span class="val">${escapeHtml(methodLabel)}</span>
            </div>
          </div>

          <!-- Row 4: Phone | Email (Left) | Ref / Instrument No (Right) -->
          <div class="header-row">
            <div class="header-col-left">
              ${(bizPhone || bizEmail) ? `
                ${bizPhone ? `<span class="label">Phone:</span> <span class="val">${escapeHtml(bizPhone)}</span>` : ''}
                ${bizPhone && bizEmail ? `<span class="pipe-sep">|</span>` : ''}
                ${bizEmail ? `<span class="label">Email:</span> <span class="val">${escapeHtml(bizEmail)}</span>` : ''}
              ` : `<span>&nbsp;</span>`}
            </div>
            <div class="header-col-right">
              ${payment.reference ? `
                <span class="label">Ref / Instrument No:</span>
                <span class="val-mono">${escapeHtml(payment.reference)}</span>
              ` : `<span>&nbsp;</span>`}
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Two-Column Info Cards -->
      <div class="two-col-cards">
        <div class="card-col customer-card-col">
          <div class="card-label">
            <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>
            RECEIVED FROM
          </div>
          <div class="card-rows">
            <!-- Row 1: Customer Name (Bold) -->
            <div class="card-row">
              <span class="card-party-name">${escapeHtml(custName)}</span>
            </div>

            <!-- Row 2: Phone | Email (clean values without label prefixes) -->
            ${(custPhone || custEmail) ? `
            <div class="card-row">
              ${custPhone ? `<span class="val">${escapeHtml(custPhone)}</span>` : ''}
              ${custPhone && custEmail ? `<span class="pipe-sep">|</span>` : ''}
              ${custEmail ? `<span class="val">${escapeHtml(custEmail)}</span>` : ''}
            </div>
            ` : ''}

            <!-- Row 3: Street Address (clean value without Address: label) -->
            ${custAddress ? `
            <div class="card-row">
              <span class="val">${escapeHtml(custAddress)}</span>
            </div>
            ` : ''}

            <!-- Row 4: City, State - Pincode (e.g. Barabanki, Uttar Pradesh - 225001) -->
            ${cityStatePin ? `
            <div class="card-row">
              <span class="val">${escapeHtml(cityStatePin)}</span>
            </div>
            ` : ''}

            <!-- Row 5: PAN: [PAN] | Aadhaar: [Aadhaar] (Keep identity badges/labels) -->
            ${(custGstin || custPan || custAadhaar) ? `
            <div class="card-row">
              ${custGstin ? `<span class="party-gstin-pill"><span class="label">GSTIN:</span> <span class="val-mono">${escapeHtml(custGstin)}</span></span>` : ''}
              ${custGstin && (custPan || custAadhaar) ? `<span class="pipe-sep">|</span>` : ''}
              ${custPan ? `<span class="party-pan-pill"><span class="label">PAN:</span> <span class="val-mono">${escapeHtml(custPan)}</span></span>` : ''}
              ${custPan && custAadhaar ? `<span class="pipe-sep">|</span>` : ''}
              ${custAadhaar ? `<span class="party-aadhaar-pill"><span class="label">Aadhaar:</span> <span class="val-mono">${escapeHtml(formatAadhaar(custAadhaar))}</span></span>` : ''}
            </div>
            ` : ''}
          </div>
        </div>

        <div class="card-col payment-details-col">
          <div class="card-label">
            <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
            PAYMENT DETAILS
          </div>
          <div class="card-rows">
            <!-- Row 1: Payment Date: DD/MM/YYYY -->
            <div class="card-row card-row-between">
              <span class="label">Payment Date:</span>
              <span class="val-mono">${escapeHtml(formatDate(payment.date))}</span>
            </div>

            <!-- Row 2: Ref / Instrument No: [ref] -->
            <div class="card-row card-row-between">
              <span class="label">Ref / Instrument No:</span>
              <span class="val-mono">${payment.reference ? escapeHtml(payment.reference) : '—'}</span>
            </div>

            <!-- Row 3: Payment Method: CASH (or Bank Transfer / Cheque) -->
            <div class="card-row card-row-between">
              <span class="label">Payment Method:</span>
              <span class="val-mono">${escapeHtml(methodLabel)}</span>
            </div>

            <!-- Row 4: Payment Status: [RECEIVED badge] -->
            <div class="card-row card-row-between">
              <span class="label">Payment Status:</span>
              <span class="status-pill">✓ RECEIVED</span>
            </div>

            <!-- Row 5: Matching spacer row to maintain 1:1 row symmetry with Left Card if 5th row present -->
            ${(custGstin || custPan || custAadhaar) ? `
            <div class="card-row card-row-between" style="visibility: hidden;">
              <span class="label">&nbsp;</span>
              <span class="val">&nbsp;</span>
            </div>
            ` : ''}
          </div>
        </div>
      </div>

      <!-- 3. Particulars Table -->
      <div class="table-box">
        <table class="receipt-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 5%">#</th>
              <th style="width: 45%">DESCRIPTION / INVOICE REF</th>
              <th class="text-right" style="width: 16%">ORIGINAL AMOUNT</th>
              <th class="text-right" style="width: 16%">ALLOCATED AMOUNT</th>
              <th class="text-right" style="width: 18%">UNALLOCATED / BALANCE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="text-center num-mono" style="color: #94a3b8; font-size: 11px;">1</td>
              <td>
                <div class="td-desc-title">
                  ${payment.invoice?.invoice_number
                    ? `Invoice ${escapeHtml(payment.invoice.invoice_number)}`
                    : 'Payment received — On Account / Advance'}
                </div>
                <div class="td-desc-sub">
                  ${payment.invoice?.invoice_number
                    ? 'Payment allocated against open sales invoice'
                    : 'Unallocated receipt credited to customer ledger'}
                </div>
                ${payment.notes ? `<div class="td-desc-note">Note: ${escapeHtml(payment.notes)}</div>` : ''}
              </td>
              <td class="text-right num-mono" style="font-weight: 600; color: #334155;">
                ${formatCurrency(amount, sym)}
              </td>
              <td class="text-right num-mono" style="font-weight: 600; color: #334155;">
                ${allocated > 0 ? formatCurrency(allocated, sym) : '—'}
              </td>
              <td class="text-right num-mono" style="font-weight: 700; color: #0f172a;">
                ${unapplied > 0 ? formatCurrency(unapplied, sym) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 4. Summary & Bank Details Section -->
      <div class="summary-grid">
        <div>
          <div class="words-card">
            <div class="words-label">AMOUNT IN WORDS</div>
            <div class="words-val">${escapeHtml(amountInWords)}</div>
          </div>

          ${hasBankDetails ? `
            <div class="bank-details-card">
              <div class="bank-header">
                <svg style="width: 12px; height: 12px; color: #94a3b8; display: inline-block; vertical-align: middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" x2="22" y1="6" y2="6"/><line x1="10" x2="10" y1="18" y2="18"/><line x1="14" x2="14" y1="18" y2="18"/><line x1="18" x2="18" y1="18" y2="18"/><line x1="6" x2="6" y1="18" y2="18"/><path d="M2 18v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2"/><path d="m12 2 10 4H2l10-4Z"/></svg>
                <span class="bank-title">BANK &amp; PAYMENT DETAILS</span>
              </div>
              <div class="bank-rows">
                ${bankName ? `<div class="bank-row"><span class="label">Bank:</span><span class="val">${escapeHtml(bankName)}</span></div>` : ''}
                ${effectiveAccountHolder ? `<div class="bank-row"><span class="label">A/C Name:</span><span class="val">${escapeHtml(effectiveAccountHolder)}</span></div>` : ''}
                ${accountNo ? `<div class="bank-row"><span class="label">A/C No:</span><span class="val-mono">${escapeHtml(accountNo)}</span></div>` : ''}
                ${ifsc ? `<div class="bank-row"><span class="label">IFSC:</span><span class="val-mono">${escapeHtml(ifsc)}</span></div>` : ''}
                ${upiId ? `<div class="bank-row"><span class="label">UPI:</span><span class="val">${escapeHtml(upiId)}</span></div>` : ''}
              </div>
            </div>
          ` : ''}
        </div>

        <div class="totals-col">
          <div class="total-line">
            <span>Total Amount:</span>
            <span class="val">${formatCurrency(amount, sym)}</span>
          </div>
          <div class="total-line">
            <span>Applied to Invoices:</span>
            <span class="val">${allocated > 0 ? formatCurrency(allocated, sym) : '—'}</span>
          </div>
          <div class="total-line">
            <span>Unallocated / Balance:</span>
            <span class="val">${unapplied > 0 ? formatCurrency(unapplied, sym) : '—'}</span>
          </div>
          <div class="grand-total-bar">
            <span class="grand-total-label">Total Received (INR):</span>
            <span class="grand-total-val">${formatCurrency(amount, sym)}</span>
          </div>
        </div>
      </div>

      <!-- 5. Footer -->
      <div class="receipt-footer-section">
        <div class="terms-box">
          <div class="terms-title">Terms &amp; Notes:</div>
          <div class="terms-content">
            ${termsList.map((line) => `<p>• ${escapeHtml(line.replace(/^[•\-\*]\s*/, ''))}</p>`).join('\n            ')}
            ${payment.notes ? `<p style="color: #0f172a; font-weight: 600;">• Note: ${escapeHtml(payment.notes)}</p>` : ''}
          </div>
        </div>

        <div class="signatory-box">
          <div class="signatory-for">
            FOR ${escapeHtml(bizName.toUpperCase())}
          </div>
          ${signatureUrl ? `
            <img src="${signatureUrl}" alt="Authorized Signature" class="sign-img" />
          ` : `
            <div class="sign-dashed">
              <span>Authorized Signatory</span>
            </div>
          `}
          <div class="sign-name">${escapeHtml(signatureName)}</div>
          <div class="sign-sub">Authorized Signatory</div>
        </div>
      </div>

      <!-- Center Bottom Disclaimer -->
      <div class="bottom-disclaimer">
        <p>This is a computer generated receipt.</p>
      </div>
    </div>
  `;
}

let isPrintingGlobal = false;

export function printPaymentReceipt(
  payment: PaymentReceiptData,
  business: PaymentReceiptBusiness | null | undefined
): void {
  if (isPrintingGlobal) return;
  isPrintingGlobal = true;

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
  if (!doc) {
    isPrintingGlobal = false;
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Receipt ${escapeHtml(payment.payment_number)}</title>
        <style>
          ${RECEIPT_STYLES}
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
    </html>
  `);
  doc.close();

  // Trigger print exactly once and cleanup
  setTimeout(() => {
    try {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
    } catch (e) {
      console.warn('print error', e);
    }
    setTimeout(() => {
      try {
        if (printFrame.parentNode) {
          printFrame.parentNode.removeChild(printFrame);
        }
      } catch {
        // Frame already removed
      }
      isPrintingGlobal = false;
    }, 1500);
  }, 350);
}
