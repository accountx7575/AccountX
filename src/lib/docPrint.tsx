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
    hsn_sac?: string;
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

// Crisp Vector SVG Logo for Solar Home (Zero network/base64 broken box issues)
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

  /* 1. Title with Underline */
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

  /* 3. Strict 1px single border outline */
  .sheet {
    border: 1px solid #000;
    width: 100%;
    border-collapse: collapse;
  }

  /* Header Box: Exact 50% split for vertical center continuity */
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
    width: 95px;
    height: 75px;
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

  /* Meta Grid: Exact font size & normal values */
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

  /* Party Row: Exact 50% split */
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

  /* Items Table: Exactly 50.0% split (8% + 42% = 50%) */
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

  /* 2. SS 2: Horizontally 1 level, font-weight: normal (400), same 10px font size */
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

  /* 1 & 2. Standalone GST Box with 6px gap and vertical divider after SGST Amount */
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

  /* 6px gap before words box */
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

  /* Bottom: Bank Details, Terms & Conditions, and Vector Signature */
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
  <!-- Title with Underline -->
  <div class="top-title">${esc(title)}</div>

  <div class="sheet">

    <!-- Header Box -->
    <div class="company-row">
      <div class="company-cell-left">
        <div class="logo-wrap">
          <img class="logo" src="${SOLAR_HOME_LOGO}" alt="Solar Home Logo"/>
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

      <!-- Meta Grid: Exact font sizing and normal data values -->
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

    <!-- Bill To & Ship To -->
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

    <!-- Items Table: Exactly 50% split on 2nd column (8% + 42% = 50%) -->
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

    <!-- GST Box: Fully closed vertical partition between SGST Amount and Total Tax Amount -->
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
            <th colspan="2" style="border-right: 1px solid #000;">SGST</th>
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

    <!-- Total Amount in words: 6px gap + Normal weight -->
    <div class="words-box-wrap">
      <div class="words">
        <div class="words-label">Total Amount (in words)</div>
        <div class="words-value">${esc(totalAmountWords)}</div>
      </div>
    </div>

    <!-- Bottom Section: Bank Details, Terms, and Native SVG Signature -->
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

      <!-- Vector Stamp/Signature for Avadh Boring Company -->
      <div class="bottom-cell-3">
        <div class="signature">
          <div class="stamp-wrap">
            <svg width="180" height="70" viewBox="0 0 200 80" style="display:block; margin:auto;">
              <text x="100" y="18" font-family="Arial, sans-serif" font-size="13.5" font-weight="bold" fill="#0b4da2" text-anchor="middle">For Avadh Boring Company</text>
              <path d="M 45 60 C 60 35, 80 25, 95 38 C 105 48, 88 72, 75 60 C 68 50, 90 34, 115 44 C 132 50, 110 68, 130 58 C 145 50, 168 52, 178 50 M 100 55 L 188 52" fill="none" stroke="#0b4da2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              <text x="180" y="66" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#0b4da2">Prop.</text>
            </svg>
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
  const htmlContent = generateOmStyleHtml(business, doc);
  return new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
}