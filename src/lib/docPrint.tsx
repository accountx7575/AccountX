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

function numberToWordsINR(num: number, appendOnly: boolean = false): string {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    let str = '';
    if (n > 99) {
      str += a[Math.floor(n / 100)] + 'Hundred ';
      n %= 100;
    }
    if (n > 19) {
      str += b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ' ');
    } else if (n > 0) {
      str += a[n];
    }
    return str;
  }

  const rounded = Math.round(num);
  if (rounded === 0) return appendOnly ? 'Zero Rupees Only' : 'Zero Rupees';

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  let out = '';
  if (crore) out += inWords(crore) + 'Crore ';
  if (lakh) out += inWords(lakh) + 'Lakh ';
  if (thousand) out += inWords(thousand) + 'Thousand ';
  if (hundred) out += inWords(hundred);

  const words = out.trim() + ' Rupees';
  return appendOnly ? words + ' Only' : words;
}

// Formats money. forceDecimals=true always shows 2 decimals (Rate/Tax/Taxable Value/GST rows).
// forceDecimals=false trims ".00" for whole numbers (used for the AMOUNT column, matching source PDF).
function formatMoney(num: number, forceDecimals: boolean = true): string {
  const n = Number(num || 0);
  if (!forceDecimals && Number.isInteger(n)) {
    return n.toLocaleString('en-IN');
  }
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SOLAR_HOME_LOGO_SVG = `
<svg width="56" height="56" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#f7941d" stroke-width="5" stroke-linecap="round">
    <line x1="50" y1="2" x2="50" y2="13"/>
    <line x1="21" y1="11" x2="28" y2="21"/>
    <line x1="79" y1="11" x2="72" y2="21"/>
    <line x1="8" y1="34" x2="20" y2="37"/>
    <line x1="92" y1="34" x2="80" y2="37"/>
  </g>
  <circle cx="50" cy="30" r="13" fill="#fdb913"/>
  <polygon points="14,58 50,30 86,58" fill="#f7941d"/>
  <line x1="14" y1="58" x2="86" y2="58" stroke="#ffffff" stroke-width="1.5"/>
  <line x1="32" y1="45" x2="32" y2="58" stroke="#ffffff" stroke-width="1.5"/>
  <line x1="50" y1="35" x2="50" y2="58" stroke="#ffffff" stroke-width="1.5"/>
  <line x1="68" y1="45" x2="68" y2="58" stroke="#ffffff" stroke-width="1.5"/>
  <rect x="24" y="58" width="52" height="30" fill="#1c3f94"/>
  <rect x="42" y="70" width="16" height="18" fill="#ffffff"/>
</svg>`;

export function generateOmStyleHtml(business: any, doc: PrintableDocData): string {
  const isInterState = doc.igst > 0;
  const totalQty = doc.items.reduce((acc, it) => acc + Number(it.quantity || 0), 0);
  const totalTaxAmount = doc.cgst + doc.sgst + doc.igst;
  const grandTotalWords = numberToWordsINR(doc.grandTotal, false);

  // OM ENTERPRISES exact bank details (fallbacks used only if business object doesn't supply them)
  const bankName = business?.bank_name || 'Indian Bank';
  const branchName = business?.bank_branch || 'LUCKNOW MOHAMMADPUR';
  const accName = business?.name || 'OM ENTERPRISES';
  const accNo = business?.bank_account_number || '50331189248';
  const ifsc = business?.bank_ifsc_code || 'IDIB000M730';
  const panNo = business?.pan_number || (business?.gstin ? business.gstin.slice(2, 12) : 'AYLPV6076C');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>${doc.docNumber} - Quotation</title>
    <style>
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      html, body {
        height: 100%;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        color: #000;
        background: #fff;
      }
      .page-container {
        width: 100%;
        max-width: 194mm;
        margin: 0 auto;
        min-height: 280mm;
        border: 1.5px solid #000;
        display: flex;
        flex-direction: column;
      }
      .header-title-bar {
        text-align: center;
        border-bottom: 1.5px solid #000;
        padding: 4px 0;
      }
      .header-title-bar h1 {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.5px;
      }
      .company-block {
        display: flex;
        border-bottom: 1.5px solid #000;
      }
      .company-left {
        width: 28%;
        padding: 8px;
        border-right: 1.5px solid #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .company-left .logo-icon {
        margin-bottom: 2px;
      }
      .company-left .badge-title {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.1;
        color: #1c3f94;
      }
      .company-left .badge-sub {
        font-size: 7.5px;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-top: 2px;
        color: #f7941d;
      }
      .company-center {
        width: 72%;
        padding: 8px 12px;
      }
      .company-name {
        font-size: 15px;
        font-weight: 800;
        margin-bottom: 3px;
        text-transform: uppercase;
      }
      .company-meta-line {
        font-size: 10px;
        line-height: 1.35;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-bottom: 1.5px solid #000;
        text-align: left;
      }
      .meta-cell {
        padding: 5px 8px;
        border-right: 1.5px solid #000;
      }
      .meta-cell:last-child {
        border-right: none;
      }
      .meta-label {
        font-size: 9.5px;
        font-weight: 700;
      }
      .meta-value {
        font-size: 11px;
        font-weight: 800;
        margin-top: 2px;
      }
      .party-grid {
        display: flex;
        border-bottom: 1.5px solid #000;
      }
      .party-cell {
        width: 50%;
        padding: 6px 8px;
        line-height: 1.35;
      }
      .party-cell:first-child {
        border-right: 1.5px solid #000;
      }
      .party-header {
        font-size: 10px;
        font-weight: 800;
        margin-bottom: 2px;
        text-transform: uppercase;
      }
      .items-fill {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        border-bottom: 1.5px solid #000;
      }
      .table-grid {
        width: 100%;
        height: 100%;
        border-collapse: collapse;
        flex: 1;
      }
      .table-grid th, .table-grid td {
        border-right: 1.5px solid #000;
        padding: 5px 6px;
        font-size: 10px;
      }
      .table-grid th:last-child, .table-grid td:last-child {
        border-right: none;
      }
      .table-grid th {
        border-bottom: 1.5px solid #000;
        background: #fafafa;
        font-weight: 800;
        text-align: center;
      }
      .spacer-row td {
        height: 100%;
        padding: 0;
        border-right: 1.5px solid #000;
      }
      .spacer-row td:last-child {
        border-right: none;
      }
      .table-total-row td {
        border-top: 1.5px solid #000;
        font-weight: 800;
        background: #fbfbfb;
      }
      .item-sub-line {
        font-size: 9px;
        font-weight: 400;
        color: #222;
        line-height: 1.5;
      }
      .tax-table {
        width: 100%;
        border-collapse: collapse;
        border-bottom: 1.5px solid #000;
        font-size: 9.5px;
      }
      .tax-table th, .tax-table td {
        border-right: 1.5px solid #000;
        border-bottom: 1px solid #000;
        padding: 4px 6px;
        text-align: center;
      }
      .tax-table th:last-child, .tax-table td:last-child {
        border-right: none;
      }
      .tax-table th {
        font-weight: 800;
        background: #f9f9f9;
      }
      .bottom-section {
        display: flex;
      }
      .bottom-left {
        width: 65%;
        border-right: 1.5px solid #000;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .bottom-right {
        width: 35%;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        text-align: center;
      }
      .bank-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 4px;
        font-size: 9.5px;
      }
      .bank-table td {
        padding: 2px 0;
      }
      .sign-box {
        height: 65px;
      }
      .authorised-label {
        font-size: 9.5px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <div class="page-container">
      <div class="header-title-bar">
        <h1>${doc.docTitle ? doc.docTitle.toUpperCase() : 'QUOTATION'}</h1>
      </div>

      <!-- Top Company Details -->
      <div class="company-block">
        <div class="company-left">
          <div class="logo-icon">${SOLAR_HOME_LOGO_SVG}</div>
          <div class="badge-title">SOLAR HOME</div>
          <div class="badge-sub">RENEWABLE ENERGY</div>
        </div>
        <div class="company-center">
          <div class="company-name">${business?.name || 'OM ENTERPRISES'}</div>
          <div class="company-meta-line">
            ${business?.address || 'NEAR -MAA DURGA MANDIR BANKI TIRAHA<br/>BARABANKI, Barabanki, Uttar Pradesh, 225001'}<br/>
            <strong>GSTIN:</strong> ${business?.gstin || '09AYLPV6076C1ZW'}&nbsp;&nbsp;&nbsp;&nbsp;<strong>PAN Number:</strong> ${panNo}<br/>
            <strong>Mobile:</strong> ${business?.phone || '8052955923'}&nbsp;&nbsp;&nbsp;&nbsp;<strong>Email:</strong> ${business?.email || 'om.enterprises09111992@gmail.com'}
          </div>
        </div>
      </div>

      <!-- Meta Grid -->
      <div class="meta-grid">
        <div class="meta-cell">
          <div class="meta-label">${doc.docTitle || 'Quotation'} No.</div>
          <div class="meta-value">${doc.docNumber}</div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">${doc.docTitle || 'Quotation'} Date</div>
          <div class="meta-value">${doc.dateValue}</div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Expiry Date</div>
          <div class="meta-value">${doc.expiryValue || '-'}</div>
        </div>
      </div>

      <!-- Bill To & Ship To -->
      <div class="party-grid">
        <div class="party-cell">
          <div class="party-header">BILL TO</div>
          <div style="font-weight: 800; font-size: 11px;">${doc.partyName}</div>
          <div style="font-size: 9.5px; color: #111;">
            Address: ${doc.partyAddress || '-'}<br/>
            Place of Supply: ${business?.state || 'Uttar Pradesh'}<br/>
            Mobile: ${doc.partyPhone || '-'}
          </div>
        </div>
        <div class="party-cell">
          <div class="party-header">SHIP TO</div>
          <div style="font-weight: 800; font-size: 11px;">${doc.partyName}</div>
          <div style="font-size: 9.5px; color: #111;">
            Address: ${doc.partyAddress || '-'}
          </div>
        </div>
      </div>

      <!-- Items Grid -->
      <div class="items-fill">
        <table class="table-grid">
          <thead>
            <tr>
              <th style="width: 32px;">S.NO.</th>
              <th style="text-align: left;">ITEMS</th>
              <th style="width: 55px;">QTY.</th>
              <th style="width: 80px; text-align: right;">RATE</th>
              <th style="width: 75px; text-align: right;">TAX</th>
              <th style="width: 85px; text-align: right;">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            ${doc.items.map((it, idx) => {
              const taxAmt = (it.total_amount - (it.taxable_amount || (it.rate * it.quantity)));
              const lines = String(it.product_name || '').split('\n').map(l => l.trim()).filter(Boolean);
              const mainLine = lines[0] || '';
              const subLines = lines.slice(1);
              return `
                <tr>
                  <td style="text-align: center; vertical-align: top;">${idx + 1}</td>
                  <td style="vertical-align: top;">
                    <strong style="font-size: 10.5px;">${mainLine}</strong>
                    ${subLines.map(l => `<div class="item-sub-line">${l}</div>`).join('')}
                  </td>
                  <td style="text-align: center; vertical-align: top;">${it.quantity} ${it.unit || 'PCS'}</td>
                  <td style="text-align: right; vertical-align: top;">${formatMoney(it.rate, true)}</td>
                  <td style="text-align: right; vertical-align: top;">
                    ${taxAmt > 0 ? formatMoney(taxAmt, true) : '0.00'}<br/>
                    <span style="font-size: 8.5px; color: #444;">(${it.tax_rate}%)</span>
                  </td>
                  <td style="text-align: right; vertical-align: top; font-weight: 700;">${formatMoney(it.total_amount, false)}</td>
                </tr>
              `;
            }).join('')}
            <tr class="spacer-row"><td colspan="6"></td></tr>
            <tr class="table-total-row">
              <td colspan="2" style="text-align: right; padding-right: 12px;">TOTAL</td>
              <td style="text-align: center;">${totalQty}</td>
              <td></td>
              <td style="text-align: right;">₹ ${formatMoney(totalTaxAmount, true)}</td>
              <td style="text-align: right; font-size: 11px;">₹ ${formatMoney(doc.grandTotal, false)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- GST Summary Grid -->
      <table class="tax-table">
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
            <td>${doc.items[0]?.hsn_sac || '-'}</td>
            <td>${formatMoney(doc.taxableAmount, true)}</td>
            <td>${doc.items[0]?.tax_rate ? (doc.items[0].tax_rate / 2) : 2.5}%</td>
            <td>${formatMoney(doc.cgst, true)}</td>
            <td>${doc.items[0]?.tax_rate ? (doc.items[0].tax_rate / 2) : 2.5}%</td>
            <td>${formatMoney(doc.sgst, true)}</td>
            <td>₹ ${formatMoney(totalTaxAmount, true)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Bottom Split -->
      <div class="bottom-section">
        <div class="bottom-left">
          <div>
            <div style="font-size: 9px; font-weight: 700; text-transform: uppercase;">Total Amount (in words)</div>
            <div style="font-size: 10.5px; font-weight: 800; margin: 2px 0 6px 0;">${grandTotalWords}</div>

            <div style="font-size: 9.5px; font-weight: 800; border-top: 1px solid #000; padding-top: 4px; margin-top: 4px;">Bank Details</div>
            <table class="bank-table">
              <tr>
                <td style="width: 60px;">Name:</td>
                <td><strong>${accName}</strong></td>
              </tr>
              <tr>
                <td>IFSC Code:</td>
                <td><strong>${ifsc}</strong></td>
              </tr>
              <tr>
                <td>Account No:</td>
                <td><strong>${accNo}</strong></td>
              </tr>
              <tr>
                <td>Bank:</td>
                <td><strong>${bankName} ,${branchName}</strong></td>
              </tr>
            </table>

            <div style="font-size: 9.5px; font-weight: 800; border-top: 1px solid #000; padding-top: 4px; margin-top: 6px;">Terms and Conditions</div>
            <div style="font-size: 8.5px; line-height: 1.35; color: #111;">
              Payment 100% Advance.<br/>
              All payments to be drawn in favour of "${business?.name || 'Om Enterprises'}.", payable at ${business?.city || 'Barabanki'}<br/>
              This quotation is valid for 15 Days, subject to availability with our principals<br/>
              <strong>ALL SUBJECT TO ${(business?.city || 'BARABANKI').toUpperCase()} JURISDICTION</strong><br/>
              (E.&amp;O.E.)
            </div>
          </div>
        </div>

        <div class="bottom-right">
          <div style="font-size: 9.5px; font-weight: 700;">
            Authorised Signatory For<br/>
            <strong>${business?.name || 'OM ENTERPRISES'}</strong>
          </div>
          <div class="sign-box"></div>
          <div style="border-top: 1px solid #000; padding-top: 3px; font-size: 8.5px;">
            Authorised Signatory
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

// Native direct print flow with iframe (Pure vector/text, no image blur)
export async function renderDocSheetToPdf(business: any, doc: PrintableDocData): Promise<void> {
  const htmlContent = generateOmStyleHtml(business, doc);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const docFrame = iframe.contentWindow?.document;
  if (docFrame) {
    docFrame.open();
    docFrame.write(htmlContent);
    docFrame.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 2000);
    }, 400);
  }
}

// Fallback PDF blob generator
export async function renderDocSheetToPdfBlob(business: any, doc: PrintableDocData): Promise<Blob> {
  const htmlContent = generateOmStyleHtml(business, doc);
  return new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
}
