import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Settings, Building2, Save, Database, Download, FileDown, Users, UserMinus, ShieldCheck, PenTool, Upload, X, BellRing, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CommunicationCenterPanel } from '@/components/settings/CommunicationCenterPanel';
import { MessageTemplatesPanel } from '@/components/settings/MessageTemplatesPanel';
import { ScheduledReportsPanel } from '@/components/settings/ScheduledReportsPanel';
import { can, capabilityTooltip, roleLabel, type Role } from '@/lib/rbac';
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry';
import { buildFullLedgerJson } from '@/lib/exportLedger';
import { TallyExportPanel } from '@/components/settings/TallyExportPanel';
import { BulkImportPanel } from '@/components/settings/BulkImportPanel';
import { PageMotion } from '@/lib/motion';
import { formatDate } from '@/lib/utils';

export interface PrintableDocData {
  docTitle: string;
  docNumber: string;
  dateLabel: string;
  dateValue: string;
  expiryLabel?: string;
  expiryValue?: string | null;
  partyLabel: string;
  partyName: string;
  partyAddress?: string;
  partyGstin?: string;
  partyPhone?: string;
  partyPlaceOfSupply?: string;
  shipToName?: string;
  shipToAddress?: string;
  shipToPhone?: string;
  shipToPlaceOfSupply?: string;
  status: string;
  items: Array<{
    product_name: string;
    hsn_sac?: string | null;
    quantity: number;
    unit?: string;
    rate: number;
    tax_rate: number;
    taxable_amount?: number;
    total_amount: number;
  }>;
  subtotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff?: number;
  grandTotal: number;
  notes?: string | null;
  terms?: string | null;
}

// Fallback Crisp Vector SVG Logo for Solar Home
const SOLAR_HOME_LOGO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="95" height="75" viewBox="0 0 110 85">
  <circle cx="55" cy="30" r="22" fill="%23f59e0b"/>
  <polygon points="55,10 18,38 24,42 55,17 86,42 92,38" fill="%231e3a8a"/>
  <polygon points="26,42 55,20 84,42 78,58 32,58" fill="%230284c7"/>
  <line x1="55" y1="20" x2="55" y2="58" stroke="%23ffffff" stroke-width="2"/>
  <line x1="38" y1="32" x2="72" y2="32" stroke="%23ffffff" stroke-width="1.5"/>
  <line x1="34" y1="44" x2="76" y2="44" stroke="%23ffffff" stroke-width="1.5"/>
  <path d="M 22 55 Q 55 70 88 55" fill="none" stroke="%2316a34a" stroke-width="4" stroke-linecap="round"/>
  <text x="55" y="70" font-family="Arial, sans-serif" font-size="11" font-weight="900" fill="%230f172a" text-anchor="middle" letter-spacing="0.5">SOLAR HOME</text>
  <text x="55" y="80" font-family="Arial, sans-serif" font-size="6.5" font-weight="700" fill="%23475569" text-anchor="middle" letter-spacing="0.4">RENEWABLE ENERGY</text>
</svg>`;

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const money = (value: number): string =>
  Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function numberToWordsINR(num: number): string {
  const a = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const b = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];

  const inWords = (n: number): string => {
    let str = '';
    if (n > 99) {
      str += `${a[Math.floor(n / 100)]} Hundred `;
      n %= 100;
    }
    if (n > 19) {
      str += `${b[Math.floor(n / 10)]}${n % 10 ? ` ${a[n % 10]}` : ''} `;
    } else if (n > 0) {
      str += `${a[n]} `;
    }
    return str;
  };

  const rounded = Math.round(Number(num || 0));
  if (rounded === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  let out = '';
  if (crore) out += `${inWords(crore)}Crore `;
  if (lakh) out += `${inWords(lakh)}Lakh `;
  if (thousand) out += `${inWords(thousand)}Thousand `;
  if (hundred) out += inWords(hundred);

  return `${out.trim()} Rupees Only`;
}

export function generateOmStyleHtml(
  business: any,
  doc: PrintableDocData,
): string {
  const isInterState = Number(doc.igst || 0) > 0;
  const totalQty = doc.items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const totalTax =
    Number(doc.cgst || 0) + Number(doc.sgst || 0) + Number(doc.igst || 0);
  const totalAmountWords = numberToWordsINR(doc.grandTotal);

  const businessName = business?.name || 'AVADH BORING COMPANY';
  const businessAddress =
    business?.address ||
    'AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001';
  const gstin = business?.gstin || '09AABPQ3096M1Z5';
  const pan =
    business?.pan || (gstin.length >= 12 ? gstin.slice(2, 12) : 'AABPQ3096M');
  const phone = business?.phone || '+91 9450942418';
  const email = business?.email || 'abc.solar7575@gmail.com';
  const state = business?.state || 'Uttar Pradesh';

  const bankName = business?.bank_name || 'Canara Bank';
  const branchName = business?.bank_branch || 'Barabanki';
  const accountName = business?.bank_account_name || 'Avadh Boring Company';
  const accountNo = business?.bank_account_number || '120034396413';
  const ifsc = business?.bank_ifsc_code || 'CNRB0018631';

  // Dynamic Logo & Stamp/Signature from Settings
  const dynamicLogo = business?.stamp_url || business?.logo_url || SOLAR_HOME_LOGO;
  const dynamicSignature = business?.signature_url || null;

  const title = doc.docTitle || 'QUOTATION';
  const shipName = doc.shipToName || doc.partyName;
  const shipAddress = doc.shipToAddress || doc.partyAddress || '';
  const shipPhone = doc.shipToPhone || doc.partyPhone || '';
  const shipPlace = doc.shipToPlaceOfSupply || doc.partyPlaceOfSupply || state;

  const firstTaxRate = Number(doc.items[0]?.tax_rate || 0);
  const halfRate = firstTaxRate / 2;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(doc.docNumber)} - ${esc(title)}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 8mm;
  }

  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10px;
    line-height: 1.25;
  }

  .page {
    width: 100%;
    max-width: 194mm;
    margin: 0 auto;
  }

  .top-title {
    height: 8.5mm;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .sheet {
    border: 1px solid #000;
    width: 100%;
    border-collapse: collapse;
  }

  .company-row {
    display: flex;
    min-height: 38mm;
    border-bottom: 1px solid #000;
  }

  .company-cell-left {
    width: 50%;
    padding: 7px 9px;
    border-right: 1px solid #000;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .logo-wrap {
    width: 100px;
    min-width: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo {
    max-width: 95px;
    max-height: 75px;
    object-fit: contain;
    display: block;
  }

  .company-info {
    min-width: 0;
  }

  .company-name {
    font-size: 15px;
    line-height: 1.1;
    font-weight: 800;
    margin-bottom: 3px;
    text-transform: uppercase;
  }

  .company-address {
    font-size: 9.5px;
    line-height: 1.25;
    margin-bottom: 4px;
  }

  .company-line {
    font-size: 9.5px;
    line-height: 1.45;
  }

  .company-cell-right {
    width: 50%;
    display: flex;
    align-items: stretch;
  }

  .meta-grid {
    width: 100%;
    display: flex;
    align-items: stretch;
  }

  .meta-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 6px 4px;
  }

  .meta-cell:not(:last-child) {
    border-right: 1px solid #000;
  }

  .meta-label {
    font-size: 11px;
    font-weight: 800;
    color: #000;
    white-space: nowrap;
    margin-bottom: 6px;
  }

  .meta-value {
    font-size: 11px;
    font-weight: 400;
    color: #111;
    white-space: nowrap;
  }

  .party-row {
    display: flex;
    border-bottom: 1px solid #000;
  }

  .party-cell {
    width: 50%;
    min-height: 27mm;
    padding: 7px 9px;
  }

  .party-cell:first-child {
    border-right: 1px solid #000;
  }

  .party-heading {
    font-size: 10.5px;
    font-weight: 800;
    margin-bottom: 4px;
  }

  .party-name {
    font-size: 11px;
    font-weight: 800;
    margin-bottom: 3px;
    text-transform: uppercase;
  }

  .party-text {
    font-size: 9.5px;
    line-height: 1.4;
  }

  .field-label {
    font-weight: 800;
    color: #000;
  }

  .items-table-wrap {
    width: 100%;
    border-bottom: 1px solid #000;
  }

  .items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .items th,
  .items td {
    border-right: 1px solid #000;
  }

  .items th:last-child,
  .items td:last-child {
    border-right: none;
  }

  .items thead th {
    height: 8.5mm;
    padding: 4px 6px;
    border-bottom: 1px solid #000;
    background: #e5e5e5;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
    letter-spacing: 0.3px;
  }

  .item-row td {
    padding: 8px 8px;
    vertical-align: top;
    font-size: 10px;
    font-weight: 400;
    line-height: 1.35;
  }

  .item-name {
    font-size: 10px;
    font-weight: 400;
    white-space: pre-line;
    line-height: 1.35;
  }

  .item-area {
    min-height: 115mm;
    height: 118mm;
  }

  .qty,
  .rate,
  .tax,
  .amount {
    text-align: right;
    white-space: nowrap;
    padding-right: 8px !important;
  }

  .qty {
    text-align: center;
    padding-right: 0 !important;
  }

  .tax-rate {
    color: #333;
    font-size: 9px;
    margin-top: 1px;
  }

  .total-row td {
    height: 8.5mm;
    padding: 4px 8px;
    background: #e5e5e5;
    border-top: 1px solid #000;
    font-size: 10.5px;
    font-weight: 800;
    vertical-align: middle;
  }

  .total-label {
    text-align: right;
    padding-right: 12px !important;
    font-size: 10.5px;
  }

  .gst-box-wrap {
    margin-top: 6px;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }

  .gst {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9.5px;
  }

  .gst th,
  .gst td {
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 4px 6px;
    text-align: center;
  }

  .gst th:last-child,
  .gst td:last-child {
    border-right: none;
  }

  .gst thead th {
    height: 6mm;
    background: #e5e5e5;
    font-weight: 800;
    font-size: 9.5px;
  }

  .gst tbody td {
    height: 6.5mm;
    font-weight: 600;
  }

  .words-box-wrap {
    margin-top: 6px;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }

  .words {
    padding: 5px 8px;
  }

  .words-label {
    font-size: 9px;
    font-weight: 800;
    margin-bottom: 2px;
  }

  .words-value {
    font-size: 10px;
    font-weight: 400;
    color: #111;
  }

  .bottom {
    display: flex;
    min-height: 34mm;
  }

  .bottom-cell-1 {
    width: 35%;
    padding: 6px 8px;
    border-right: 1px solid #000;
  }

  .bottom-cell-2 {
    width: 35%;
    padding: 6px 8px;
    border-right: 1px solid #000;
  }

  .bottom-cell-3 {
    width: 30%;
    padding: 6px 8px;
  }

  .section-title {
    font-size: 10px;
    font-weight: 800;
    margin-bottom: 5px;
  }

  .bank-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
  }

  .bank-table td {
    padding: 2px 0;
    vertical-align: top;
  }

  .bank-label {
    width: 72px;
    white-space: nowrap;
    color: #111;
  }

  .terms {
    font-size: 8.8px;
    line-height: 1.35;
    white-space: pre-line;
  }

  .signature {
    display: flex;
    flex-direction: column;
    height: 100%;
    text-align: center;
    justify-content: space-between;
  }

  .stamp-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    flex: 1;
    padding: 4px 0;
  }

  .stamp-wrap img {
    max-width: 170px;
    max-height: 65px;
    object-fit: contain;
    margin: auto;
  }

  .sign-line {
    border-top: 1px solid #000;
    padding-top: 3px;
    font-size: 9px;
    font-weight: 700;
  }

  @media print {
    .page {
      max-width: none;
    }

    .sheet {
      break-inside: avoid;
    }

    .items,
    .gst,
    .bottom {
      break-inside: avoid;
    }
  }
</style>
</head>

<body>
<div class="page">
  <div class="top-title">${esc(title)}</div>

  <div class="sheet">
    <div class="company-row">
      <div class="company-cell-left">
        <div class="logo-wrap">
          <img class="logo" src="${dynamicLogo}" alt="${esc(businessName)} Logo"/>
        </div>

        <div class="company-info">
          <div class="company-name">${esc(businessName)}</div>
          <div class="company-address">${esc(businessAddress)}</div>

          <div class="company-line">
            <strong>GSTIN:</strong> ${esc(gstin)}
          </div>

          <div class="company-line">
            <strong>Mobile:</strong> ${esc(phone)}
          </div>

          <div class="company-line">
            <strong>PAN Number:</strong> ${esc(pan)}
          </div>

          <div class="company-line">
            <strong>Email:</strong> ${esc(email)}
          </div>
        </div>
      </div>

      <div class="company-cell-right">
        <div class="meta-grid">
          <div class="meta-cell">
            <div class="meta-label">${esc(doc.docTitle || 'QUOTATION')} No.</div>
            <div class="meta-value">${esc(doc.docNumber || '—')}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.dateLabel || 'Quote Date')}</div>
            <div class="meta-value">${esc(doc.dateValue || '—')}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.expiryLabel || 'Valid Until')}</div>
            <div class="meta-value">${esc(doc.expiryValue || '—')}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="party-row">
      <div class="party-cell">
        <div class="party-heading">BILL TO</div>
        <div class="party-name">${esc(doc.partyName)}</div>
        <div class="party-text">
          <span class="field-label">Address:</span>&nbsp; ${esc(doc.partyAddress || '—')}<br/>
          <span class="field-label">Place of Supply:</span>&nbsp; ${esc(doc.partyPlaceOfSupply || state)}<br/>
          <span class="field-label">Mobile:</span>&nbsp; ${esc(doc.partyPhone || '—')}
          ${doc.partyGstin ? `<br/><span class="field-label">GSTIN:</span>&nbsp; ${esc(doc.partyGstin)}` : ''}
        </div>
      </div>

      <div class="party-cell">
        <div class="party-heading">SHIP TO</div>
        <div class="party-name">${esc(shipName)}</div>
        <div class="party-text">
          <span class="field-label">Address:</span>&nbsp; ${esc(shipAddress || '—')}<br/>
          <span class="field-label">Place of Supply:</span>&nbsp; ${esc(shipPlace)}<br/>
          <span class="field-label">Mobile:</span>&nbsp; ${esc(shipPhone || '—')}
        </div>
      </div>
    </div>

    <div class="items-table-wrap">
      <table class="items">
        <colgroup>
          <col style="width: 8%">
          <col style="width: 42%">
          <col style="width: 10%">
          <col style="width: 13%">
          <col style="width: 12%">
          <col style="width: 15%">
        </colgroup>

        <thead>
          <tr>
            <th>S.NO.</th>
            <th>ITEMS</th>
            <th>QTY.</th>
            <th>RATE</th>
            <th>TAX</th>
            <th>AMOUNT</th>
          </tr>
        </thead>

        <tbody>
          ${doc.items
            .map((item, index) => {
              const taxable = Number(
                item.taxable_amount ??
                  Number(item.rate || 0) * Number(item.quantity || 0),
              );
              const taxAmount = Math.max(
                0,
                Number(item.total_amount || 0) - taxable,
              );

              return `
            <tr class="item-row">
              <td class="qty item-area">${index + 1}</td>
              <td class="item-area">
                <div class="item-name">${esc(item.product_name)}</div>
              </td>
              <td class="qty item-area">${esc(item.quantity)} ${esc(item.unit || 'PCS')}</td>
              <td class="rate item-area">₹ ${money(item.rate)}</td>
              <td class="tax item-area">
                ₹ ${money(taxAmount)}
                <div class="tax-rate">(${esc(item.tax_rate)}%)</div>
              </td>
              <td class="amount item-area">₹ ${money(item.total_amount)}</td>
            </tr>`;
            })
            .join('')}

          <tr class="total-row">
            <td></td>
            <td class="total-label">TOTAL</td>
            <td class="qty">${esc(totalQty)}</td>
            <td></td>
            <td class="tax">₹ ${money(totalTax)}</td>
            <td class="amount">₹ ${money(doc.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="gst-box-wrap">
      ${
        isInterState
          ? `
      <table class="gst">
        <colgroup>
          <col style="width: 14%">
          <col style="width: 24%">
          <col style="width: 12%">
          <col style="width: 20%">
          <col style="width: 30%">
        </colgroup>
        <thead>
          <tr>
            <th>HSN/SAC</th>
            <th>Taxable Value</th>
            <th>IGST Rate</th>
            <th>IGST Amount</th>
            <th>Total Tax Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${esc(doc.items[0]?.hsn_sac || '—')}</td>
            <td>₹ ${money(doc.taxableAmount)}</td>
            <td>${esc(firstTaxRate)}%</td>
            <td style="border-right: 1px solid #000;">₹ ${money(doc.igst)}</td>
            <td>₹ ${money(totalTax)}</td>
          </tr>
        </tbody>
      </table>`
          : `
      <table class="gst">
        <colgroup>
          <col style="width: 14%">
          <col style="width: 24%">
          <col style="width: 9%">
          <col style="width: 15%">
          <col style="width: 9%">
          <col style="width: 15%">
          <col style="width: 14%">
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">HSN/SAC</th>
            <th rowspan="2">Taxable Value</th>
            <th colspan="2">CGST</th>
            <th colspan="2">SGST</th>
            <th rowspan="2">Total Tax Amount</th>
          </tr>
          <tr>
            <th>Rate</th>
            <th>Amount</th>
            <th>Rate</th>
            <th style="border-right: 1px solid #000;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${esc(doc.items[0]?.hsn_sac || '—')}</td>
            <td>₹ ${money(doc.taxableAmount)}</td>
            <td>${halfRate}%</td>
            <td>₹ ${money(doc.cgst)}</td>
            <td>${halfRate}%</td>
            <td style="border-right: 1px solid #000;">₹ ${money(doc.sgst)}</td>
            <td>₹ ${money(totalTax)}</td>
          </tr>
        </tbody>
      </table>`
      }
    </div>

    <div class="words-box-wrap">
      <div class="words">
        <div class="words-label">Total Amount (in words)</div>
        <div class="words-value">${esc(totalAmountWords)}</div>
      </div>
    </div>

    <div class="bottom">
      <div class="bottom-cell-1">
        <div class="section-title">Bank Details</div>
        <table class="bank-table">
          <tr><td class="bank-label">Name:</td><td><strong>${esc(accountName)}</strong></td></tr>
          <tr><td class="bank-label">IFSC Code:</td><td><strong>${esc(ifsc)}</strong></td></tr>
          <tr><td class="bank-label">Account No:</td><td><strong>${esc(accountNo)}</strong></td></tr>
          <tr><td class="bank-label">Bank:</td><td><strong>${esc(bankName)}, ${esc(branchName)}</strong></td></tr>
        </table>
      </div>

      <div class="bottom-cell-2">
        <div class="section-title">Terms and Conditions</div>
        <div class="terms">
          ${esc(
            doc.terms ||
              `Payment 100% Advance.
All payments to be drawn in favour of "${businessName}", payable at Barabanki
This quotation is valid for 15 Days, subject to availability with our principals
ALL SUBJECT TO BARABANKI JURISDICTION
(E. & O.E.)`,
          )}
        </div>
      </div>

      <div class="bottom-cell-3">
        <div class="signature">
          <div class="stamp-wrap">
            ${
              dynamicSignature
                ? `<img src="${dynamicSignature}" alt="Authorized Signature"/>`
                : `<svg width="180" height="70" viewBox="0 0 200 80" style="display:block; margin:auto;">
                    <text x="100" y="18" font-family="Arial, sans-serif" font-size="13.5" font-weight="bold" fill="#0b4da2" text-anchor="middle">For ${esc(businessName)}</text>
                    <path d="M 45 60 C 60 35, 80 25, 95 38 C 105 48, 88 72, 75 60 C 68 50, 90 34, 115 44 C 132 50, 110 68, 130 58 C 145 50, 168 52, 178 50 M 100 55 L 188 52" fill="none" stroke="#0b4da2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                    <text x="180" y="66" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#0b4da2">Prop.</text>
                  </svg>`
            }
          </div>
          <div class="sign-line">Authorised Signatory</div>
        </div>
      </div>
    </div>

  </div>
</div>
</body>
</html>`;
}

export async function renderDocSheetToPdf(
  business: any,
  doc: PrintableDocData,
): Promise<void> {
  const htmlContent = generateOmStyleHtml(business, doc);

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  document.body.appendChild(iframe);

  const frameDocument = iframe.contentWindow?.document;

  if (!frameDocument) {
    document.body.removeChild(iframe);
    throw new Error('Unable to create print document.');
  }

  frameDocument.open();
  frameDocument.write(htmlContent);
  frameDocument.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 2000);
  }, 500);
}

export async function renderDocSheetToPdfBlob(
  business: any,
  doc: PrintableDocData,
): Promise<Blob> {
  // Canonical native-vector engine lives in @/lib/docPrint — delegate so
  // every download path produces identical selectable-text PDFs.
  const { renderDocSheetToPdfBlob: renderVectorPdfBlob } = await import(
    '@/lib/docPrint'
  );
  return renderVectorPdfBlob(business, doc);
}


const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Chandigarh','Puducherry'];

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const UPI_ID_REGEX = /^[A-Za-z0-9.@-]{2,60}$/;
const IFSC_REGEX = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CsvRow = Record<string, string | number | boolean | null>;

function toCsvValue(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(columns: string[], rows: CsvRow[]): string {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => toCsvValue(r[c])).join(','));
  return [header, ...body].join('\r\n');
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CUSTOMER_COLUMNS = ['name','company_name','phone','email','gstin','pan','address','city','state','pincode','opening_balance','current_balance','total_sales','credit_limit','status','notes','created_at'];
const SUPPLIER_COLUMNS = ['name','company_name','phone','email','gstin','pan','address','city','state','pincode','opening_balance','current_balance','status','notes','created_at'];
const PRODUCT_COLUMNS = ['name','sku','barcode','type','hsn_sac','unit','purchase_price','selling_price','tax_rate','tax_inclusive','opening_stock','current_stock','minimum_stock','description','is_active','created_at'];
const SALES_INVOICE_COLUMNS = ['invoice_number','invoice_date','due_date','customer','status','payment_status','place_of_supply','subtotal','discount_amount','taxable_amount','cgst_amount','sgst_amount','igst_amount','cess_amount','round_off','grand_total','paid_amount','balance_amount','product_name','hsn_sac','quantity','unit','rate','line_discount_amount','tax_rate','line_taxable_amount','line_cgst_amount','line_sgst_amount','line_igst_amount','line_total_amount'];
const PURCHASE_BILL_COLUMNS = ['bill_number','bill_date','due_date','supplier','status','payment_status','subtotal','discount_amount','taxable_amount','cgst_amount','sgst_amount','igst_amount','cess_amount','round_off','grand_total','paid_amount','balance_amount','product_name','hsn_sac','quantity','unit','rate','line_discount_amount','tax_rate','line_taxable_amount','line_cgst_amount','line_sgst_amount','line_igst_amount','line_total_amount'];

function StampSignatureSlot({
  title,
  hint,
  value,
  disabled,
  onPick,
  onRemove,
}: {
  title: string;
  hint: string;
  value: string | null | undefined;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputId = `img-${title.replace(/[^a-z]+/gi, '-').toLowerCase()}`;
  return (
    <div className="rounded-xl border border-secondary-200 dark:border-secondary-700 p-4">
      <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{title}</p>
      <p className="text-xs text-secondary-400 mt-0.5 mb-3">{hint}</p>
      <div className="h-20 rounded-lg border border-dashed border-secondary-300 dark:border-secondary-600 bg-secondary-50/60 dark:bg-secondary-800/40 flex items-center justify-center overflow-hidden mb-3">
        {value ? (
          <img src={value} alt={title} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[11px] text-secondary-300 px-4 text-center leading-tight">No image uploaded</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className={
            disabled
              ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary-100 dark:bg-secondary-800 text-secondary-400 cursor-not-allowed'
              : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/50 cursor-pointer transition-colors'
          }
        >
          <Upload className="h-3.5 w-3.5" />
          {value ? 'Replace' : 'Upload Image'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = '';
          }}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove image"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-error-600 dark:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
          >
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </div>
    </div>
  );
}

type BusinessMemberRow = {
  membership_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role | string;
  is_active: boolean | null;
  invited_at: string | null;
  joined_at: string | null;
};

export function SettingsPage() {
  const { activeBusiness, activeRole, user, refreshBusinesses } = useAuth();
  const { toast } = useToast();
  const { logAdminEvent } = useAdminTelemetry();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', legal_name: '', phone: '', email: '', address: '', city: '', state: 'Maharashtra',
    gstin: '', pan: '', financial_year: '2026-27', currency_symbol: '₹', invoice_prefix: 'INV',
    gst_registered: false,
    stamp_url: '' as string | null,
    signature_url: '' as string | null,
    upi_id: '',
    invoice_footer_text: '',
    invoice_signature_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_ifsc_code: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState<string | null>(null);

  const canEditSettings = can(activeRole, 'settings.edit');
  const canManageMembers = can(activeRole, 'members.manage');
  const canExportData = can(activeRole, 'data.export');
  const settingsLockTooltip = capabilityTooltip('settings.edit', activeRole);

  useEffect(() => {
    if (activeBusiness) {
      setForm({
        name: activeBusiness.name || '',
        legal_name: activeBusiness.legal_name || '',
        phone: activeBusiness.phone || '',
        email: activeBusiness.email || '',
        address: activeBusiness.address || '',
        city: activeBusiness.city || '',
        state: activeBusiness.state || 'Maharashtra',
        gstin: activeBusiness.gstin || '',
        pan: activeBusiness.pan || '',
        financial_year: activeBusiness.financial_year || '2026-27',
        currency_symbol: activeBusiness.currency_symbol || '₹',
        invoice_prefix: activeBusiness.invoice_prefix || 'INV',
        gst_registered: activeBusiness.gst_registered,
        stamp_url: activeBusiness.stamp_url || '',
        signature_url: activeBusiness.signature_url || '',
        upi_id: activeBusiness.upi_id || '',
        invoice_footer_text: activeBusiness.invoice_footer_text || '',
        invoice_signature_name: activeBusiness.invoice_signature_name || '',
        bank_name: activeBusiness.bank_name || '',
        bank_account_number: activeBusiness.bank_account_number || '',
        bank_ifsc_code: activeBusiness.bank_ifsc_code || '',
      });
    }
  }, [activeBusiness]);

  /* ------------------------------ image reader ------------------------------- */

  const readImageFile = (file: File, field: 'stamp_url' | 'signature_url') => {
    if (!file.type.startsWith('image/')) {
      toast('Please upload an image file (PNG, JPG, or SVG)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (file.type === 'image/svg+xml' || file.size < 600 * 1024) {
        setForm((prev) => ({ ...prev, [field]: result }));
        toast('Image selected successfully! Click "Save All Settings" below.', 'info');
        return;
      }

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = Math.min(img.width, MAX_WIDTH);
        canvas.height = img.width > MAX_WIDTH ? img.height * scaleSize : img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png', 0.9);
        setForm((prev) => ({ ...prev, [field]: dataUrl }));
        toast('Image selected and optimized! Click "Save All Settings" below.', 'info');
      };
      img.src = result;
    };
    reader.onerror = () => toast('Could not read the selected image', 'error');
    reader.readAsDataURL(file);
  };

  const ownerFallbackRows = (): BusinessMemberRow[] => {
    if (!user) return [];
    return [{
      membership_id: `fallback-${user.id}`,
      user_id: user.id,
      email: user.email ?? null,
      full_name: (user.user_metadata?.name as string | undefined) ?? null,
      role: activeRole ?? 'owner',
      is_active: true,
      invited_at: null,
      joined_at: null,
    }];
  };

  const membersQuery = useQuery({
    queryKey: ['business-members', activeBusiness?.id],
    queryFn: async (): Promise<BusinessMemberRow[]> => {
      if (!activeBusiness || !user) return ownerFallbackRows();
      try {
        const { data, error } = await supabase
          .from('v_member_directory')
          .select('membership_id, user_id, email, full_name, role, is_active, invited_at, joined_at')
          .eq('business_id', activeBusiness.id)
          .order('joined_at');
        if (error) throw error;
        const rows = (data ?? []) as BusinessMemberRow[];
        if (rows.length === 0) return ownerFallbackRows();
        return rows;
      } catch {
        return ownerFallbackRows();
      }
    },
    enabled: !!activeBusiness,
    retry: false,
  });

  const removeMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      if (!activeBusiness) throw new Error('No active business');
      const { data, error } = await supabase.rpc('remove_business_member', {
        p_business_id: activeBusiness.id,
        p_target_user_id: targetUserId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast('Member removed from business', 'success');
      await queryClient.invalidateQueries({ queryKey: ['business-members', activeBusiness?.id] });
      await refreshBusinesses();
    },
    onError: (err: Error) => toast(err.message || 'Failed to remove member', 'error'),
  });

  function removalBlockReason(m: BusinessMemberRow): string | null {
    if (!canManageMembers) return capabilityTooltip('members.manage', activeRole);
    if (m.user_id === user?.id) return "You can't remove yourself";
    if (m.role === 'owner') return 'The business owner cannot be removed';
    return null;
  }

  function confirmRemove(m: BusinessMemberRow) {
    let impersonating = false;
    try {
      impersonating =
        localStorage.getItem('super_admin_impersonating') === 'true' ||
        localStorage.getItem('accountx_impersonating') === 'true';
    } catch {
      impersonating = false;
    }
    if (impersonating) {
      toast('Disabled in Super Admin support mode — exit to Admin Control Center to manage members.', 'error');
      void logAdminEvent('DESTRUCTIVE_BLOCKED', activeBusiness?.id ?? null, {
        attempted: 'remove_business_member',
        target_user_id: m.user_id,
      });
      return;
    }
    const reason = removalBlockReason(m);
    if (reason) return;
    if (window.confirm('Remove this member from the business? Their access ends immediately.')) {
      removeMutation.mutate(m.user_id);
    }
  }

  /* ----------------------------- settings ------------------------------- */

  const fyOptions = useMemo(() => {
    const nowYear = new Date().getFullYear();
    const options: string[] = [];
    for (let y = nowYear + 1; y >= nowYear - 3; y--) {
      options.push(`${y}-${String((y + 1) % 100).padStart(2, '0')}`);
    }
    return options;
  }, []);

  const fyList = useMemo(() => {
    if (form.financial_year && !fyOptions.includes(form.financial_year)) {
      return [...fyOptions, form.financial_year];
    }
    return fyOptions;
  }, [fyOptions, form.financial_year]);

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Business name is required';
    if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) e.email = 'Enter a valid email address';
    if (form.gst_registered) {
      if (!form.gstin.trim()) e.gstin = 'GSTIN is required for GST-registered businesses';
      else if (!GSTIN_REGEX.test(form.gstin.trim())) e.gstin = 'Invalid GSTIN — expected 15 chars: 2-digit state code + PAN + entity number + Z + checksum';
    } else if (form.gstin.trim() && !GSTIN_REGEX.test(form.gstin.trim())) {
      e.gstin = 'Invalid GSTIN — expected 15 chars: 2-digit state code + PAN + entity number + Z + checksum';
    }
    if (form.pan.trim() && !PAN_REGEX.test(form.pan.trim())) e.pan = 'Invalid PAN — expected 10 chars like ABCDE1234F';
    if (form.upi_id.trim() && !UPI_ID_REGEX.test(form.upi_id.trim())) e.upi_id = 'Invalid UPI ID — use only letters, numbers, dots, @ and dashes (e.g. business@upi)';
    if (form.bank_ifsc_code.trim() && !IFSC_REGEX.test(form.bank_ifsc_code.trim())) e.bank_ifsc_code = 'Invalid IFSC - format SBIN0001234';
    if (form.bank_account_number.trim() && !/^[0-9][0-9 -]{4,18}[0-9]$/.test(form.bank_account_number.trim())) e.bank_account_number = 'Account number must be 6-20 digits (spaces/dashes allowed)';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const payload: Record<string, unknown> = {
        name: form.name,
        legal_name: form.legal_name || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        city: form.city || null,
        state: form.state,
        pan: form.pan || null,
        financial_year: form.financial_year,
        currency_symbol: form.currency_symbol,
        invoice_prefix: form.invoice_prefix,
        gst_registered: form.gst_registered,
        stamp_url: form.stamp_url || null,
        signature_url: form.signature_url || null,
        upi_id: form.upi_id || null,
        invoice_footer_text: form.invoice_footer_text.trim() || null,
        invoice_signature_name: form.invoice_signature_name.trim() || null,
        bank_name: form.bank_name.trim() || null,
        bank_account_number: form.bank_account_number || null,
        bank_ifsc_code: form.bank_ifsc_code.toUpperCase() || null,
      };
      if (form.gst_registered) {
        payload.gstin = form.gstin || null;
      }
      const { error } = await supabase.from('businesses').update(payload).eq('id', activeBusiness.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshBusinesses();
      toast('Business settings updated successfully', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to update settings', 'error'),
  });

  async function exportFullLedger() {
    if (!activeBusiness) return;
    setExporting('full-ledger');
    try {
      const bundle = await buildFullLedgerJson(activeBusiness.id);
      downloadJson(`accountx-full-ledger_${activeBusiness.name.replace(/[^a-z0-9]+/gi, '-')}_${bundle.fiscalYear.replace(/\s+/g, '')}.json`, JSON.stringify(bundle, null, 2));
      toast('Full-ledger backup downloaded', 'success');
    } catch (err: any) {
      toast(err.message || 'Backup failed', 'error');
    } finally {
      setExporting(null);
    }
  }

  function downloadJson(filename: string, json: string) {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function fetchAll<T>(table: string, orderCol: string): Promise<T[]> {
    if (!activeBusiness) throw new Error('No active business');
    const { data, error } = await supabase.from(table).select('*').eq('business_id', activeBusiness.id).order(orderCol);
    if (error) throw error;
    return (data || []) as T[];
  }

  async function exportTable(key: string, label: string, table: string, orderCol: string, columns: string[]) {
    setExporting(key);
    try {
      const rows = await fetchAll<CsvRow>(table, orderCol);
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-${key}.csv`, toCsv(columns, rows));
      toast(`${label} exported (${rows.length} rows)`, 'success');
    } catch (err: any) {
      toast(err.message || `Failed to export ${label}`, 'error');
    } finally {
      setExporting(null);
    }
  }

  async function exportSalesInvoices() {
    setExporting('sales-invoices');
    try {
      if (!activeBusiness) throw new Error('No active business');
      const bid = activeBusiness.id;
      const { data: invoices, error: invError } = await supabase
        .from('sales_invoices')
        .select('*, customer:customers(name)')
        .eq('business_id', bid)
        .order('invoice_date');
      if (invError) throw invError;
      const list = (invoices || []) as (Record<string, unknown> & { id: string; customer?: { name: string } | null })[];
      const ids = list.map((i) => i.id);
      const { data: lines, error: lineError } = ids.length
        ? await supabase.from('sales_invoice_items').select('*').in('invoice_id', ids)
        : { data: [], error: null };
      if (lineError) throw lineError;
      const lineRows = ((lines || []) as Record<string, unknown>[]);
      const linesByInvoice = new Map<string, Record<string, unknown>[]>();
      lineRows.forEach((l) => {
        const arr = linesByInvoice.get(l.invoice_id as string) || [];
        arr.push(l);
        linesByInvoice.set(l.invoice_id as string, arr);
      });
      const rows: CsvRow[] = [];
      list.forEach((inv) => {
        const docLines = linesByInvoice.get(inv.id) || [{}];
        docLines.forEach((l) => {
          rows.push({
            invoice_number: inv.invoice_number as string,
            invoice_date: inv.invoice_date as string,
            due_date: (inv.due_date as string) || '',
            customer: inv.customer?.name || '',
            status: inv.status as string,
            payment_status: inv.payment_status as string,
            place_of_supply: (inv.place_of_supply as string) || '',
            subtotal: inv.subtotal as number,
            discount_amount: inv.discount_amount as number,
            taxable_amount: inv.taxable_amount as number,
            cgst_amount: inv.cgst_amount as number,
            sgst_amount: inv.sgst_amount as number,
            igst_amount: inv.igst_amount as number,
            cess_amount: inv.cess_amount as number,
            round_off: inv.round_off as number,
            grand_total: inv.grand_total as number,
            paid_amount: inv.paid_amount as number,
            balance_amount: inv.balance_amount as number,
            product_name: (l.product_name as string) || '',
            hsn_sac: (l.hsn_sac as string) || '',
            quantity: l.quantity as number,
            unit: (l.unit as string) || '',
            rate: l.rate as number,
            line_discount_amount: l.discount_amount as number,
            tax_rate: l.tax_rate as number,
            line_taxable_amount: l.taxable_amount as number,
            line_cgst_amount: l.cgst_amount as number,
            line_sgst_amount: l.sgst_amount as number,
            line_igst_amount: l.igst_amount as number,
            line_total_amount: l.total_amount as number,
          });
        });
      });
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-sales-invoices.csv`, toCsv(SALES_INVOICE_COLUMNS, rows));
      toast(`Sales invoices exported (${rows.length} line items)`, 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to export sales invoices', 'error');
    } finally {
      setExporting(null);
    }
  }

  async function exportPurchaseBills() {
    setExporting('purchase-bills');
    try {
      if (!activeBusiness) throw new Error('No active business');
      const bid = activeBusiness.id;
      const { data: bills, error: billError } = await supabase
        .from('purchase_bills')
        .select('*, supplier:suppliers(name)')
        .eq('business_id', bid)
        .order('bill_date');
      if (billError) throw billError;
      const list = (bills || []) as (Record<string, unknown> & { id: string; supplier?: { name: string } | null })[];
      const ids = list.map((b) => b.id);
      const { data: lines, error: lineError } = ids.length
        ? await supabase.from('purchase_bill_items').select('*').in('bill_id', ids)
        : { data: [], error: null };
      if (lineError) throw lineError;
      const lineRows = ((lines || []) as Record<string, unknown>[]);
      const linesByBill = new Map<string, Record<string, unknown>[]>();
      lineRows.forEach((l) => {
        const arr = linesByBill.get(l.bill_id as string) || [];
        arr.push(l);
        linesByBill.set(l.bill_id as string, arr);
      });
      const rows: CsvRow[] = [];
      list.forEach((bill) => {
        const docLines = linesByBill.get(bill.id) || [{}];
        docLines.forEach((l) => {
          rows.push({
            bill_number: bill.bill_number as string,
            bill_date: bill.bill_date as string,
            due_date: (bill.due_date as string) || '',
            supplier: bill.supplier?.name || '',
            status: bill.status as string,
            payment_status: bill.payment_status as string,
            subtotal: bill.subtotal as number,
            discount_amount: bill.discount_amount as number,
            taxable_amount: bill.taxable_amount as number,
            cgst_amount: bill.cgst_amount as number,
            sgst_amount: bill.sgst_amount as number,
            igst_amount: bill.igst_amount as number,
            cess_amount: bill.cess_amount as number,
            round_off: bill.round_off as number,
            grand_total: bill.grand_total as number,
            paid_amount: bill.paid_amount as number,
            balance_amount: bill.balance_amount as number,
            product_name: (l.product_name as string) || '',
            hsn_sac: (l.hsn_sac as string) || '',
            quantity: l.quantity as number,
            unit: (l.unit as string) || '',
            rate: l.rate as number,
            line_discount_amount: l.discount_amount as number,
            tax_rate: l.tax_rate as number,
            line_taxable_amount: l.taxable_amount as number,
            line_cgst_amount: l.cgst_amount as number,
            line_sgst_amount: l.sgst_amount as number,
            line_igst_amount: l.igst_amount as number,
            line_total_amount: l.total_amount as number,
          });
        });
      });
      downloadCsv(`${activeBusiness?.name?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'accountx'}-purchase-bills.csv`, toCsv(PURCHASE_BILL_COLUMNS, rows));
      toast(`Purchase bills exported (${rows.length} line items)`, 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to export purchase bills', 'error');
    } finally {
      setExporting(null);
    }
  }

  const sym = '₹';

  if (!activeBusiness) return null;

  return (
    <PageMotion>
      <PageHeader title="Settings" subtitle="Manage your business configuration" />

      <nav aria-label="Settings sections" className="sticky top-[64px] z-20 -mx-1 mb-4 flex gap-2 overflow-x-auto py-2 px-1 backdrop-blur-sm">
        {[
          { id: 'settings-members', label: 'Members' },
          { id: 'settings-profile', label: 'Business Profile' },
          { id: 'settings-gst', label: 'GST & Tax' },
          { id: 'settings-signature', label: 'Signature & Stamp' },
          { id: 'settings-invoice', label: 'Invoice' },
          { id: 'settings-comms', label: 'Notifications & Comms' },
          { id: 'settings-export', label: 'Data Export' },
          { id: 'settings-import', label: 'Bulk Import' },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="shrink-0 rounded-full border border-secondary-200 dark:border-secondary-700 bg-white/80 dark:bg-zinc-900/80 px-3.5 py-1.5 text-xs font-medium text-secondary-600 dark:text-secondary-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </nav>

      {!canEditSettings && (
        <div className="card p-4 mb-6 flex items-center gap-3 border-warning-300 dark:border-warning-700">
          <ShieldCheck className="h-5 w-5 text-warning-500 shrink-0" />
          <p className="text-sm text-secondary-600 dark:text-secondary-400">
            You have <span className="font-semibold text-secondary-900 dark:text-secondary-100">{roleLabel(activeRole)}</span> access — business settings are read-only for you.
          </p>
        </div>
      )}

      <div className="space-y-6 scroll-mt-24">
        {/* Members */}
        <div id="settings-members" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <Users className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Team Members</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">People with access to this business</p>
            </div>
          </div>

          {membersQuery.isLoading ? (
            <div className="animate-pulse space-y-2" aria-busy="true">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800" />
              ))}
            </div>
          ) : (membersQuery.data ?? []).length === 0 ? (
            <EmptyState icon={Users} title="No members listed" description="Membership records could not be loaded for this business." />
          ) : (
            <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {(membersQuery.data ?? []).map((m) => {
                const blockReason = removalBlockReason(m);
                const isYou = m.user_id === user?.id;
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3 px-2 -mx-2 rounded-lg transition-colors hover:bg-secondary-50/70 dark:hover:bg-secondary-800/40">
                    <div className={
                      m.role === 'owner'
                        ? 'h-9 w-9 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0'
                        : 'h-9 w-9 rounded-full bg-secondary-200 dark:bg-secondary-700 flex items-center justify-center text-xs font-semibold text-secondary-600 dark:text-secondary-300 shrink-0'
                    } aria-hidden="true">
                      {m.role === 'owner' ? '★' : roleLabel(m.role).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">
                        {m.full_name || (isYou ? user?.email || 'You' : m.email) || `Member ${m.user_id.slice(0, 8)}…`}
                        {isYou && <span className="ml-1.5 text-xs font-normal text-primary-500">(you)</span>}
                      </p>
                      <p className="figure text-xs text-secondary-400 truncate">{m.email || (m.joined_at ? `Joined ${formatDate(m.joined_at)}` : 'Join date unavailable')}</p>
                    </div>
                    {m.is_active === false && (
                      <Badge variant="error">deactivated</Badge>
                    )}
                    <Badge variant={m.role === 'owner' ? 'primary' : m.is_active === false ? 'neutral' : 'info'}>
                      {roleLabel(m.role)}
                      {m.is_active === false ? ' · inactive' : ''}
                    </Badge>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => confirmRemove(m)}
                      disabled={!!blockReason}
                      loading={removeMutation.isPending && removeMutation.variables === m.user_id}
                      title={blockReason ?? `Remove ${roleLabel(m.role)} from this business`}
                      aria-label={`Remove member with role ${roleLabel(m.role)}`}
                    >
                      <UserMinus className="h-3.5 w-3.5" /> Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!canManageMembers && (
            <p className="mt-4 text-xs text-secondary-400">
              Member management requires owner or admin access — removal stays disabled until then.
            </p>
          )}
        </div>

        {/* Business Profile */}
        <div id="settings-profile" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <Building2 className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Business Profile</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Update your business information</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Business Name" required error={errors.name}>
              <Input value={form.name} disabled={!canEditSettings} title={!canEditSettings ? settingsLockTooltip : undefined} onChange={(e) => { clearError('name'); setForm({ ...form, name: e.target.value }); }} />
            </FormField>
            <FormField label="Legal Name"><Input value={form.legal_name} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} /></FormField>
            <FormField label="Phone"><Input type="tel" value={form.phone} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></FormField>
            <FormField label="Email" error={errors.email}>
              <Input type="email" value={form.email} disabled={!canEditSettings} onChange={(e) => { clearError('email'); setForm({ ...form, email: e.target.value }); }} />
            </FormField>
            <FormField label="City"><Input value={form.city} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, city: e.target.value })} /></FormField>
            <FormField label="UPI ID" error={errors.upi_id}>
              <Input
                value={form.upi_id}
                disabled={!canEditSettings}
                maxLength={60}
                placeholder="business@upi"
                onChange={(e) => { clearError('upi_id'); setForm({ ...form, upi_id: e.target.value.trim() }); }}
              />
              <p className="text-xs text-secondary-400 mt-1">Shown on invoices for UPI QR payments</p>
            </FormField>
            <FormField label="Bank Name">
              <Input
                value={form.bank_name}
                disabled={!canEditSettings}
                maxLength={80}
                placeholder="HDFC Bank"
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              />
            </FormField>
            <FormField label="Account Number" error={errors.bank_account_number}>
              <Input
                value={form.bank_account_number}
                disabled={!canEditSettings}
                maxLength={20}
                placeholder="1234567890"
                onChange={(e) => { clearError('bank_account_number'); setForm({ ...form, bank_account_number: e.target.value }); }}
              />
              <p className="text-xs text-secondary-400 mt-1">Printed on documents - never shared</p>
            </FormField>
            <FormField label="IFSC Code" error={errors.bank_ifsc_code}>
              <Input
                value={form.bank_ifsc_code}
                disabled={!canEditSettings}
                maxLength={11}
                placeholder="SBIN0001234"
                onChange={(e) => { clearError('bank_ifsc_code'); setForm({ ...form, bank_ifsc_code: e.target.value.toUpperCase() }); }}
              />
            </FormField>
            <FormField label="State">
              <Select value={form.state} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </FormField>
          </div>
          <div className="mt-4">
            <FormField label="Address"><Textarea value={form.address} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} /></FormField>
          </div>
        </div>

        {/* GST & Tax */}
        <div id="settings-gst" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-success-100 dark:bg-success-900/30 p-2.5">
              <Settings className="h-5 w-5 text-success-600 dark:text-success-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">GST & Tax Settings</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Configure GST registration details</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="GSTIN" error={errors.gstin}>
              <Input
                value={form.gstin}
                onChange={(e) => { clearError('gstin'); setForm({ ...form, gstin: e.target.value.toUpperCase() }); }}
                onBlur={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase().trim() })}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
                disabled={!form.gst_registered || !canEditSettings}
              />
            </FormField>
            <FormField label="PAN" error={errors.pan}>
              <Input
                value={form.pan}
                onChange={(e) => { clearError('pan'); setForm({ ...form, pan: e.target.value.toUpperCase() }); }}
                onBlur={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().trim() })}
                maxLength={10}
                placeholder="ABCDE1234F"
                disabled={!canEditSettings}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-3 mt-4 p-4 rounded-lg border border-secondary-200 dark:border-secondary-700 cursor-pointer hover:bg-secondary-50 dark:hover:bg-secondary-800/50">
            <input
              type="checkbox"
              checked={form.gst_registered}
              onChange={(e) => {
                if (!canEditSettings) return;
                const checked = e.target.checked;
                setForm((f) => ({ ...f, gst_registered: checked, gstin: checked ? f.gstin : '' }));
                if (checked) clearError('gstin');
              }}
              disabled={!canEditSettings}
              className="h-4 w-4 rounded accent-primary-600"
            />
            <div>
              <span className="text-sm font-medium text-secondary-900 dark:text-secondary-100">GST Registered Business</span>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Enable GST calculations on invoices and purchases</p>
            </div>
          </label>
          {!form.gst_registered && (
            <p className="mt-2 text-xs text-secondary-400">Disable GST registration to clear and hide GSTIN entry.</p>
          )}
        </div>

        {/* Signature & Stamp */}
        <div id="settings-signature" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <PenTool className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Signature &amp; Stamp</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Auto-rendered on every quotation &amp; invoice (PNG, JPG or SVG)</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StampSignatureSlot
              title="Company / Firm Logo"
              hint="Rendered top-left on quotation and sales invoice header"
              value={form.stamp_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'stamp_url')}
              onRemove={() => setForm((prev) => ({ ...prev, stamp_url: '' }))}
            />
            <StampSignatureSlot
              title="Company / Firm Stamp & Sign"
              hint="Transparent PNG recommended - sits above the sign line"
              value={form.signature_url}
              disabled={!canEditSettings}
              onPick={(f) => readImageFile(f, 'signature_url')}
              onRemove={() => setForm((prev) => ({ ...prev, signature_url: '' }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <FormField label="Signature Name">
              <Input
                value={form.invoice_signature_name}
                disabled={!canEditSettings}
                maxLength={80}
                placeholder="e.g. Rajesh Kumar - Proprietor"
                onChange={(e) => setForm((prev) => ({ ...prev, invoice_signature_name: e.target.value }))}
              />
              <p className="text-xs text-secondary-400 mt-1">Printed above the signature block when set</p>
            </FormField>
            <FormField label="Invoice Footer Text">
              <Textarea
                value={form.invoice_footer_text}
                disabled={!canEditSettings}
                rows={2}
                placeholder="e.g. Goods once sold will not be taken back. Subject to Barabanki jurisdiction."
                onChange={(e) => setForm((prev) => ({ ...prev, invoice_footer_text: e.target.value }))}
              />
              <p className="text-xs text-secondary-400 mt-1">Rendered as a centred line under invoice totals when set</p>
            </FormField>
          </div>
          <p className="mt-3 text-xs text-secondary-400">
            Saved with Business Settings below. Quotations and Invoices render these automatically.
          </p>
        </div>

        {/* Invoice Settings */}
        <div id="settings-invoice" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <FileDown className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Invoice Settings</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Customize invoice numbering and currency</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Invoice Prefix"><Input value={form.invoice_prefix} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} placeholder="INV" /></FormField>
            <FormField label="Financial Year">
              <Select value={form.financial_year} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, financial_year: e.target.value })}>
                {fyList.map((fy) => <option key={fy} value={fy}>{fy}</option>)}
              </Select>
            </FormField>
            <FormField label="Currency Symbol"><Input value={form.currency_symbol} disabled={!canEditSettings} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} placeholder={sym} /></FormField>
          </div>
        </div>

        {/* Data Export */}
        <div id="settings-export" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-secondary-100 dark:bg-secondary-800 p-2.5">
              <Database className="h-5 w-5 text-secondary-600 dark:text-secondary-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Data Export</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Download your data as CSV files</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" loading={exporting === 'customers'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('customers', 'Customers', 'customers', 'name', CUSTOMER_COLUMNS)}>
              <Download className="h-4 w-4" /> Customers CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'suppliers'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('suppliers', 'Suppliers', 'suppliers', 'name', SUPPLIER_COLUMNS)}>
              <Download className="h-4 w-4" /> Suppliers CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'products'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={() => exportTable('products', 'Products', 'products', 'name', PRODUCT_COLUMNS)}>
              <Download className="h-4 w-4" /> Products CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'sales-invoices'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={exportSalesInvoices}>
              <Download className="h-4 w-4" /> Sales Invoices CSV
            </Button>
            <Button variant="secondary" loading={exporting === 'purchase-bills'} disabled={!canExportData} title={capabilityTooltip('data.export', activeRole) || undefined} onClick={exportPurchaseBills}>
              <Download className="h-4 w-4" /> Purchase Bills CSV
            </Button>
            <Button
              variant="secondary"
              loading={exporting === 'full-ledger'}
              disabled={!canExportData}
              title={capabilityTooltip('data.export', activeRole) || 'Full-ledger JSON backup (current fiscal year)'}
              onClick={exportFullLedger}
            >
              <Database className="h-4 w-4" /> Full-Ledger Backup (JSON)
            </Button>
          </div>

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <TallyExportPanel
              businessId={activeBusiness.id}
              companyName={activeBusiness.name}
              business={activeBusiness}
            />
          </div>
        </div>

        {/* Bulk Import */}
        <div id="settings-import" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-primary-100 dark:bg-primary-900/30 p-2.5">
              <Upload className="h-5 w-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Bulk Import</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Bring in customers, suppliers and products from CSV</p>
            </div>
          </div>
          <BulkImportPanel businessId={activeBusiness.id} />
        </div>

        {/* Notifications & Communication */}
        <div id="settings-comms" className="card p-6 scroll-mt-28">
          <div className="flex items-center gap-3 mb-5">
            <div className="rounded-lg bg-accent-100 dark:bg-accent-900/30 p-2.5">
              <BellRing className="h-5 w-5 text-accent-600 dark:text-accent-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Notifications &amp; Communication</h3>
              <p className="text-xs text-secondary-500 dark:text-secondary-400">Providers, templates, test sends, preferences and scheduled report delivery</p>
            </div>
            <Link
              to="/app/communications"
              className="ml-auto inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Delivery history <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <CommunicationCenterPanel />

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-1">Message templates</h4>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4">Edit the wording used by every send across the app</p>
            <MessageTemplatesPanel />
          </div>

          <div className="mt-6 pt-6 border-t border-secondary-100 dark:border-secondary-800">
            <h4 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-1">Scheduled reports</h4>
            <p className="text-xs text-secondary-500 dark:text-secondary-400 mb-4">Recurring report delivery by email on your cadence</p>
            <ScheduledReportsPanel />
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            onClick={() => { if (validate()) saveMutation.mutate(); }}
            loading={saveMutation.isPending}
            size="lg"
            disabled={!canEditSettings}
            title={!canEditSettings ? settingsLockTooltip : undefined}
          >
            <Save className="h-4 w-4" /> Save All Settings
          </Button>
        </div>
      </div>
    </PageMotion>
  );
}