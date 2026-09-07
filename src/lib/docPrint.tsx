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
const REF_STAMP = 'data:image/jpeg;base64,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';

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

  // The reference PDF is a CGST + SGST document. For interstate documents,
  // render an IGST summary instead of incorrectly splitting IGST into CGST/SGST.
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
    height: 9mm;
    display: flex;
    align-items: center;
    font-size: 13px;
    font-weight: 700;
  }

  .sheet {
    border: 1px solid #000;
    width: 100%;
  }

  .company-row {
    display: grid;
    grid-template-columns: 50% 50%;
    min-height: 38mm;
    border-bottom: 1px solid #000;
  }

  .company-cell {
    padding: 7px 9px;
  }

  .company-cell:first-child {
    border-right: 1px solid #000;
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .logo-wrap {
    width: 104px;
    min-width: 104px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo {
    width: 98px;
    max-height: 86px;
    object-fit: contain;
  }

  .company-info {
    min-width: 0;
  }

  .company-name {
    font-size: 16px;
    line-height: 1.05;
    font-weight: 800;
    margin-bottom: 3px;
    text-transform: uppercase;
  }

  .company-address {
    font-size: 10px;
    line-height: 1.22;
    margin-bottom: 5px;
  }

  .company-line {
    font-size: 9.5px;
    line-height: 1.32;
  }

  .meta-grid {
    height: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    align-items: center;
  }

  .meta-cell {
    padding: 6px 8px;
    text-align: center;
  }

  .meta-label {
    font-size: 9.5px;
    font-weight: 700;
    margin-bottom: 3px;
  }

  .meta-value {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }

  .party-row {
    display: grid;
    grid-template-columns: 50% 50%;
    border-bottom: 1px solid #000;
  }

  .party-cell {
    min-height: 29mm;
    padding: 7px 9px;
  }

  .party-cell:first-child {
    border-right: 1px solid #000;
  }

  .party-heading {
    font-size: 10px;
    font-weight: 800;
    margin-bottom: 5px;
  }

  .party-name {
    font-size: 10.5px;
    font-weight: 800;
    margin-bottom: 4px;
    text-transform: uppercase;
  }

  .party-text {
    font-size: 9.5px;
    line-height: 1.45;
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
    border-right: 0;
  }

  .items thead th {
    height: 8mm;
    padding: 4px 5px;
    border-bottom: 1px solid #000;
    background: #e5e5e5;
    font-size: 9.5px;
    font-weight: 800;
    text-align: center;
  }

  .items tbody td {
    padding: 5px 7px;
    vertical-align: top;
    font-size: 9.5px;
  }

  .item-area {
    height: 116mm;
  }

  .item-row {
    height: 100%;
  }

  .item-name {
    font-size: 10px;
    font-weight: 500;
    white-space: pre-line;
    line-height: 1.38;
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
    font-size: 8.5px;
    margin-top: 1px;
  }

  .total-row td {
    height: 8mm;
    padding: 4px 6px;
    background: #e5e5e5;
    border-top: 1px solid #000;
    font-weight: 800;
    vertical-align: middle;
  }

  .total-label {
    text-align: right;
    padding-right: 12px !important;
  }

  .gst {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 9px;
  }

  .gst th,
  .gst td {
    border-right: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 3px 5px;
    text-align: center;
  }

  .gst th:last-child,
  .gst td:last-child {
    border-right: 0;
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
    border-bottom: 1px solid #000;
  }

  .words-label {
    font-size: 9px;
    font-weight: 800;
    margin-bottom: 2px;
  }

  .words-value {
    font-size: 9.5px;
    font-weight: 500;
  }

  .bottom {
    display: grid;
    grid-template-columns: 34% 34% 32%;
    min-height: 31mm;
  }

  .bottom-cell {
    padding: 6px 8px;
  }

  .bottom-cell:not(:last-child) {
    border-right: 1px solid #000;
  }

  .section-title {
    font-size: 9.5px;
    font-weight: 800;
    margin-bottom: 5px;
  }

  .bank-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.8px;
  }

  .bank-table td {
    padding: 1.5px 0;
    vertical-align: top;
  }

  .bank-label {
    width: 62px;
    white-space: nowrap;
  }

  .terms {
    font-size: 8.7px;
    line-height: 1.28;
    white-space: pre-line;
  }

  .signature {
    display: flex;
    flex-direction: column;
    height: 100%;
    text-align: center;
  }

  .sign-heading {
    font-size: 9px;
    font-weight: 700;
    line-height: 1.25;
  }

  .stamp {
    width: 60px;
    height: 60px;
    object-fit: contain;
    margin: 1px auto 0;
  }

  .sign-line {
    border-top: 1px solid #000;
    padding-top: 3px;
    font-size: 8.5px;
    margin-top: auto;
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
      <div class="company-cell">
        <div class="logo-wrap">
          <img class="logo" src="${REF_LOGO}" alt="Solar Home"/>
        </div>

        <div class="company-info">
          <div class="company-name">${esc(businessName)}</div>
          <div class="company-address">${esc(businessAddress)}</div>

          <div class="company-line">
            <strong>GSTIN:</strong> ${esc(gstin)}
            &nbsp;&nbsp;&nbsp;&nbsp;
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

      <div class="company-cell">
        <div class="meta-grid">
          <div class="meta-cell">
            <div class="meta-label">${esc(doc.docTitle || 'Quotation')} No.</div>
            <div class="meta-value">${esc(doc.docNumber)}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.dateLabel || 'Quotation Date')}</div>
            <div class="meta-value">${esc(doc.dateValue)}</div>
          </div>

          <div class="meta-cell">
            <div class="meta-label">${esc(doc.expiryLabel || 'Expiry Date')}</div>
            <div class="meta-value">${esc(doc.expiryValue || '')}</div>
          </div>
        </div>
      </div>
    </div>

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

    <table class="items">
      <colgroup>
        <col style="width: 8%">
        <col style="width: 43%">
        <col style="width: 9%">
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

    ${
      isInterState
        ? `
    <table class="gst">
      <colgroup>
        <col style="width: 13%">
        <col style="width: 24%">
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
        <col style="width: 13%">
        <col style="width: 24%">
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

    <div class="words">
      <div class="words-label">Total Amount (in words)</div>
      <div class="words-value">${esc(totalAmountWords)}</div>
    </div>

    <div class="bottom">
      <div class="bottom-cell">
        <div class="section-title">Bank Details</div>
        <table class="bank-table">
          <tr><td class="bank-label">Name:</td><td><strong>${esc(accountName)}</strong></td></tr>
          <tr><td class="bank-label">IFSC Code:</td><td><strong>${esc(ifsc)}</strong></td></tr>
          <tr><td class="bank-label">Account No:</td><td><strong>${esc(accountNo)}</strong></td></tr>
          <tr><td class="bank-label">Bank:</td><td><strong>${esc(bankName)}, ${esc(branchName)}</strong></td></tr>
        </table>
      </div>

      <div class="bottom-cell">
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

      <div class="bottom-cell">
        <div class="signature">
          <div class="sign-heading">
            Authorised Signatory For<br/>
            <strong>${esc(businessName)}</strong>
          </div>

          <img class="stamp" src="${REF_STAMP}" alt="Authorised stamp"/>

          <div class="sign-line">Authorised Signatory</div>
        </div>
      </div>
    </div>

  </div>
</div>
</body>
</html>`;
}

// Native direct print flow — browser print dialog -> Save as PDF.
// Kept as vector/text for sharp PDF output.
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

  // Wait for the embedded reference images/fonts/layout to be ready.
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

// Kept for compatibility with existing callers.
export async function renderDocSheetToPdfBlob(
  business: any,
  doc: PrintableDocData,
): Promise<Blob> {
  const htmlContent = generateOmStyleHtml(business, doc);
  return new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
}
