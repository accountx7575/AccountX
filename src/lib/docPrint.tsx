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

const REF_LOGO = 'data:image/jpeg;base64,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';

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
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
    'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

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
  const totalQty = doc.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalTax = Number(doc.cgst || 0) + Number(doc.sgst || 0) + Number(doc.igst || 0);
  const totalAmountWords = numberToWordsINR(doc.grandTotal);

  const businessName = business?.name || 'AVADH BORING COMPANY';
  const businessAddress =
    business?.address ||
    'AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001';
  const gstin = business?.gstin || '09AABPQ3096M1Z5';
  const pan = business?.pan || (gstin.length >= 12 ? gstin.slice(2, 12) : 'AABPQ3096M');
  const phone = business?.phone || '9450942418';
  const email = business?.email || 'abc.solar7575@gmail.com';
  const state = business?.state || 'Uttar Pradesh';

  const bankName = business?.bank_name || 'Canara Bank';
  const branchName = business?.bank_branch || 'Barabanki';
  const accountName = business?.bank_account_name || businessName;
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
    margin: 6mm 8mm;
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
    font-size: 10.5px;
    line-height: 1.25;
  }

  .page {
    width: 100%;
    max-width: 194mm;
    margin: 0 auto;
  }

  /* 1st requirement: QUOTATION Center aligned */
  .top-title {
    height: 9mm;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    text-align: center;
  }

  /* 7th requirement: Proper solid outline and boxing */
  .sheet {
    border: 1.5px solid #000;
    width: 100%;
  }

  .company-row {
    display: flex;
    min-height: 38mm;
    border-bottom: 1.5px solid #000;
  }

  .company-cell-left {
    width: 50%;
    border-right: 1.5px solid #000;
    display: flex;
    align-items: center;
    padding: 8px 10px;
    gap: 12px;
  }

  .logo-wrap {
    width: 110px;
    min-width: 110px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo {
    width: 105px;
    max-height: 90px;
    object-fit: contain;
  }

  .company-info {
    min-width: 0;
  }

  /* 3rd requirement: Larger & cleaner company headings */
  .company-name {
    font-size: 15px;
    line-height: 1.1;
    font-weight: 800;
    margin-bottom: 4px;
    text-transform: uppercase;
  }

  .company-address {
    font-size: 9.5px;
    line-height: 1.25;
    margin-bottom: 5px;
  }

  /* 2nd requirement: Mobile No. & PAN on clean separate lines below GSTIN */
  .company-line {
    font-size: 9.5px;
    line-height: 1.4;
  }

  .company-cell-right {
    width: 50%;
    display: flex;
    align-items: center;
  }

  /* 3rd requirement: Better balanced and proportioned meta headers */
  .meta-grid {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr;
    align-items: center;
  }

  .meta-cell {
    padding: 6px 6px;
    text-align: center;
  }

  .meta-label {
    font-size: 10.5px;
    font-weight: 800;
    margin-bottom: 4px;
  }

  .meta-value {
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .party-row {
    display: flex;
    border-bottom: 1.5px solid #000;
  }

  .party-cell {
    width: 50%;
    min-height: 27mm;
    padding: 7px 10px;
  }

  .party-cell:first-child {
    border-right: 1.5px solid #000;
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

  /* 4th requirement: Adjusted column sizes so vertical lines line up */
  .items {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }

  .items th,
  .items td {
    border-right: 1.5px solid #000;
  }

  .items th:last-child,
  .items td:last-child {
    border-right: 0;
  }

  .items thead th {
    height: 8mm;
    padding: 4px 5px;
    border-bottom: 1.5px solid #000;
    background: #e5e5e5;
    font-size: 10px;
    font-weight: 800;
    text-align: center;
  }

  .items tbody td {
    padding: 6px 7px;
    vertical-align: top;
    font-size: 10px;
  }

  .item-area {
    height: 112mm;
  }

  .item-name {
    font-size: 10.5px;
    font-weight: 600;
    white-space: pre-line;
    line-height: 1.4;
  }

  .qty,
  .rate,
  .tax,
  .amount {
    text-align: right;
    white-space: nowrap;
  }

  .qty {
    text-align: center;
  }

  .tax-rate {
    color: #444;
    font-size: 9px;
    margin-top: 1px;
  }

  /* 5th & 7th requirement: Enclosed total row closing the items box */
  .total-row td {
    height: 8mm;
    padding: 4px 6px;
    background: #e5e5e5;
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
    font-weight: 800;
    vertical-align: middle;
  }

  .total-label {
    text-align: right;
    padding-right: 12px !important;
  }

  /* 5th & 7th requirement: GST Box as separate distinct table block with 1.5px outer border */
  .gst-wrap {
    width: 100%;
    border-bottom: 1.5px solid #000;
    margin: 0;
    padding: 0;
  }

  .gst {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9.5px;
  }

  .gst th,
  .gst td {
    border-right: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
    padding: 3px 5px;
    text-align: center;
  }

  .gst th:last-child,
  .gst td:last-child {
    border-right: 0;
  }

  .gst tbody tr:last-child td {
    border-bottom: 0;
  }

  .gst thead th {
    height: 5.5mm;
    background: #e5e5e5;
    font-weight: 800;
  }

  .gst tbody td {
    height: 6mm;
  }

  .words {
    padding: 5px 8px;
    border-bottom: 1.5px solid #000;
  }

  .words-label {
    font-size: 9px;
    font-weight: 800;
    margin-bottom: 2px;
  }

  .words-value {
    font-size: 10px;
    font-weight: 600;
  }

  .bottom {
    display: flex;
    min-height: 33mm;
  }

  .bottom-cell-left {
    width: 34%;
    border-right: 1.5px solid #000;
    padding: 6px 8px;
  }

  .bottom-cell-mid {
    width: 35%;
    border-right: 1.5px solid #000;
    padding: 6px 8px;
  }

  .bottom-cell-right {
    width: 31%;
    padding: 6px 8px;
  }

  .section-title {
    font-size: 9.5px;
    font-weight: 800;
    margin-bottom: 4px;
  }

  .bank-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9px;
  }

  .bank-table td {
    padding: 1.5px 0;
    vertical-align: top;
  }

  .bank-label {
    width: 65px;
    white-space: nowrap;
  }

  .terms {
    font-size: 8.8px;
    line-height: 1.32;
    white-space: pre-line;
  }

  .signature {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    text-align: center;
  }

  .sign-heading {
    font-size: 9px;
    font-weight: 700;
    line-height: 1.25;
  }

  /* 7th requirement: High-resolution official seal/signature */
  .stamp {
    max-width: 125px;
    max-height: 52px;
    object-fit: contain;
    margin: 4px auto;
    display: block;
  }

  .sign-line {
    border-top: 1px solid #000;
    width: 100%;
    padding-top: 3px;
    font-size: 8.5px;
    font-weight: 600;
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
  <!-- 1st requirement: Centered title -->
  <div class="top-title">${esc(title)}</div>

  <div class="sheet">

    <!-- Header / Company & Meta -->
    <div class="company-row">
      <div class="company-cell-left">
        <div class="logo-wrap">
          <img class="logo" src="${REF_LOGO}" alt="Solar Home"/>
        </div>

        <div class="company-info">
          <div class="company-name">${esc(businessName)}</div>
          <div class="company-address">${esc(businessAddress)}</div>

          <!-- 2nd requirement: Mobile on dedicated line below GSTIN -->
          <div class="company-line"><strong>GSTIN:</strong> ${esc(gstin)}</div>
          <div class="company-line"><strong>Mobile:</strong> +91 ${esc(phone)}</div>
          <div class="company-line"><strong>PAN Number:</strong> ${esc(pan)}</div>
          <div class="company-line"><strong>Email:</strong> ${esc(email)}</div>
        </div>
      </div>

      <!-- 3rd requirement: Larger & better centered fonts -->
      <div class="company-cell-right">
        <div class="meta-grid">
          <div class="meta-cell">
            <div class="meta-label">${esc(doc.docTitle || 'QUOTATION')} No.</div>
            <div class="meta-value">${esc(doc.docNumber)}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.dateLabel || 'Quote Date')}</div>
            <div class="meta-value">${esc(doc.dateValue)}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.expiryLabel || 'Valid Until')}</div>
            <div class="meta-value">${esc(doc.expiryValue || '')}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bill To / Ship To -->
    <div class="party-row">
      <div class="party-cell">
        <div class="party-heading">BILL TO</div>
        <div class="party-name">${esc(doc.partyName)}</div>
        <div class="party-text">
          Address:&nbsp; ${esc(doc.partyAddress || '')}<br/>
          Place of Supply:&nbsp; ${esc(doc.partyPlaceOfSupply || state)}<br/>
          Mobile:&nbsp; ${esc(doc.partyPhone || '')}
          ${doc.partyGstin ? `<br/>GSTIN:&nbsp; ${esc(doc.partyGstin)}` : ''}
        </div>
      </div>

      <div class="party-cell">
        <div class="party-heading">SHIP TO</div>
        <div class="party-name">${esc(shipName)}</div>
        <div class="party-text">
          Address:&nbsp; ${esc(shipAddress)}<br/>
          Place of Supply:&nbsp; ${esc(shipPlace)}<br/>
          Mobile:&nbsp; ${esc(shipPhone)}
        </div>
      </div>
    </div>

    <!-- 4th requirement: Precise column widths for 100% alignment -->
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
        ${doc.items.map((item, index) => {
          const taxable = Number(
            item.taxable_amount ?? Number(item.rate || 0) * Number(item.quantity || 0)
          );
          const taxAmount = Math.max(0, Number(item.total_amount || 0) - taxable);

          return `
          <tr class="item-row">
            <td class="qty item-area">${index + 1}</td>
            <td class="item-area">
              <div class="item-name">${esc(item.product_name)}</div>
            </td>
            <td class="qty item-area">${esc(item.quantity)} ${esc(item.unit || 'PCS')}</td>
            <td class="rate item-area">${money(item.rate)}</td>
            <td class="tax item-area">
              ${money(taxAmount)}
              <div class="tax-rate">(${esc(item.tax_rate)}%)</div>
            </td>
            <td class="amount item-area"><strong>${money(item.total_amount)}</strong></td>
          </tr>`;
        }).join('')}

        <!-- 5th requirement: Item table closed here with solid border -->
        <tr class="total-row">
          <td></td>
          <td class="total-label">TOTAL</td>
          <td class="qty">${esc(totalQty)}</td>
          <td></td>
          <td class="tax">${money(totalTax)}</td>
          <td class="amount">${money(doc.grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    <!-- 5th & 7th requirement: Independent enclosed GST Table block -->
    <div class="gst-wrap">
    ${
      isInterState
        ? `
      <table class="gst">
        <colgroup>
          <col style="width: 14%">
          <col style="width: 23%">
          <col style="width: 10%">
          <col style="width: 15%">
          <col style="width: 38%">
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
            <td>${money(doc.taxableAmount)}</td>
            <td>${esc(firstTaxRate)}%</td>
            <td>${money(doc.igst)}</td>
            <td>${money(totalTax)}</td>
          </tr>
        </tbody>
      </table>`
        : `
      <table class="gst">
        <colgroup>
          <col style="width: 14%">
          <col style="width: 23%">
          <col style="width: 9%">
          <col style="width: 15%">
          <col style="width: 9%">
          <col style="width: 15%">
          <col style="width: 15%">
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
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${esc(doc.items[0]?.hsn_sac || '—')}</td>
            <td>${money(doc.taxableAmount)}</td>
            <td>${halfRate}%</td>
            <td>${money(doc.cgst)}</td>
            <td>${halfRate}%</td>
            <td>${money(doc.sgst)}</td>
            <td>${money(totalTax)}</td>
          </tr>
        </tbody>
      </table>`
    }
    </div>

    <!-- Amount In Words -->
    <div class="words">
      <div class="words-label">Total Amount (in words)</div>
      <div class="words-value">${esc(totalAmountWords)}</div>
    </div>

    <!-- Footer Information -->
    <div class="bottom">
      <div class="bottom-cell-left">
        <div class="section-title">Bank Details</div>
        <table class="bank-table">
          <tr><td class="bank-label">Name:</td><td><strong>${esc(accountName)}</strong></td></tr>
          <tr><td class="bank-label">IFSC Code:</td><td><strong>${esc(ifsc)}</strong></td></tr>
          <tr><td class="bank-label">Account No:</td><td><strong>${esc(accountNo)}</strong></td></tr>
          <tr><td class="bank-label">Bank:</td><td><strong>${esc(bankName)}, ${esc(branchName)}</strong></td></tr>
        </table>
      </div>

      <div class="bottom-cell-mid">
        <div class="section-title">Terms and Conditions</div>
        <div class="terms">
          ${esc(
            doc.terms ||
            `Payment 100% Advance.
All payments to be drawn in favour of "${businessName}", payable at Barabanki
This quotation is valid for 15 Days, subject to availability with our principals
ALL SUBJECT TO BARABANKI JURISDICTION
(E. & O.E.)`
          )}
        </div>
      </div>

      <!-- 7th requirement: Stamp & Signature properly mounted -->
      <div class="bottom-cell-right">
        <div class="signature">
          <div class="sign-heading">
            Authorised Signatory For<br/>
            <strong>${esc(businessName)}</strong>
          </div>

          <img class="stamp" src="${REF_STAMP}" alt="Avadh Boring Company Signature"/>

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
  }, 400);
}

export async function renderDocSheetToPdfBlob(
  business: any,
  doc: PrintableDocData,
): Promise<Blob> {
  const htmlContent = generateOmStyleHtml(business, doc);
  return new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
}