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

function numberToWordsINR(num: number): string {
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
  if (rounded === 0) return 'Zero Rupees Only';

  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  let out = '';
  if (crore) out += inWords(crore) + 'Crore ';
  if (lakh) out += inWords(lakh) + 'Lakh ';
  if (thousand) out += inWords(thousand) + 'Thousand ';
  if (hundred) out += inWords(hundred);

  return out.trim() + ' Rupees Only';
}

export function generateOmStyleHtml(business: any, doc: PrintableDocData): string {
  const isInterState = doc.igst > 0;
  const totalQty = doc.items.reduce((acc, it) => acc + Number(it.quantity || 0), 0);
  const totalTaxAmount = doc.cgst + doc.sgst + doc.igst;
  const grandTotalWords = numberToWordsINR(doc.grandTotal);

  // Canara Bank exact details
  const bankName = business?.bank_name || 'Canara Bank';
  const branchName = 'Barabanki';
  const accName = business?.name || 'Avadh Boring Company';
  const accNo = business?.bank_account_number || '120034396413';
  const ifsc = business?.bank_ifsc_code || 'CNRB0018631';
  const panNo = business?.gstin ? business.gstin.slice(2, 12) : 'AABPQ3096M';

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
        border: 1.5px solid #000;
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
        justify-content: center;
      }
      .company-left .badge-title {
        font-size: 14px;
        font-weight: 800;
        line-height: 1.1;
      }
      .company-left .badge-sub {
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-top: 2px;
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
      .table-grid {
        width: 100%;
        border-collapse: collapse;
        border-bottom: 1.5px solid #000;
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
      .table-total-row td {
        border-top: 1.5px solid #000;
        font-weight: 800;
        background: #fbfbfb;
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
        <h1>QUOTATION</h1>
      </div>

      <!-- Top Company Details -->
      <div class="company-block">
        <div class="company-left">
          <div class="badge-title">SOLAR HOME</div>
          <div class="badge-sub">RENEWABLE ENERGY</div>
        </div>
        <div class="company-center">
          <div class="company-name">${business?.name || 'AVADH BORING COMPANY'}</div>
          <div class="company-meta-line">
            AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001<br/>
            <strong>GSTIN:</strong> ${business?.gstin || '09AABPQ3096M1Z5'}&nbsp;&nbsp;&nbsp;&nbsp;<strong>PAN Number:</strong> ${panNo}<br/>
            <strong>Mobile:</strong> ${business?.phone || '9450942418'}&nbsp;&nbsp;&nbsp;&nbsp;<strong>Email:</strong> ${business?.email || 'abc.solar7575@gmail.com'}
          </div>
        </div>
      </div>

      <!-- Meta Grid -->
      <div class="meta-grid">
        <div class="meta-cell">
          <div class="meta-label">Quotation No.</div>
          <div class="meta-value">${doc.docNumber}</div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Quotation Date</div>
          <div class="meta-value">${doc.dateValue}</div>
        </div>
        <div class="meta-cell">
          <div class="meta-label">Expiry Date</div>
          <div class="meta-value">${doc.expiryValue || '29/07/2026'}</div>
        </div>
      </div>

      <!-- Bill To & Ship To -->
      <div class="party-grid">
        <div class="party-cell">
          <div class="party-header">BILL TO</div>
          <div style="font-weight: 800; font-size: 11px;">${doc.partyName}</div>
          <div style="font-size: 9.5px; color: #111;">
            Address: ${doc.partyAddress || 'Daxin Tola Banki, Barabanki, Uttar Pradesh, 225001'}<br/>
            Place of Supply: ${business?.state || 'Uttar Pradesh'}<br/>
            Mobile: ${doc.partyPhone || '7985032002'}
          </div>
        </div>
        <div class="party-cell">
          <div class="party-header">SHIP TO</div>
          <div style="font-weight: 800; font-size: 11px;">${doc.partyName}</div>
          <div style="font-size: 9.5px; color: #111;">
            Address: ${doc.partyAddress || 'Daxin Tola Banki, Barabanki, Uttar Pradesh, 225001'}<br/>
            Place of Supply: ${business?.state || 'Uttar Pradesh'}<br/>
            Mobile: ${doc.partyPhone || '7985032002'}
          </div>
        </div>
      </div>

      <!-- Items Grid -->
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
            return `
              <tr>
                <td style="text-align: center; vertical-align: top;">${idx + 1}</td>
                <td style="vertical-align: top;">
                  <strong style="font-size: 10.5px;">${it.product_name}</strong>
                </td>
                <td style="text-align: center; vertical-align: top;">${it.quantity} ${it.unit || 'PCS'}</td>
                <td style="text-align: right; vertical-align: top;">${it.rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style="text-align: right; vertical-align: top;">
                  ${taxAmt > 0 ? taxAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}<br/>
                  <span style="font-size: 8.5px; color: #444;">(${it.tax_rate}%)</span>
                </td>
                <td style="text-align: right; vertical-align: top; font-weight: 700;">${it.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            `;
          }).join('')}
          <tr class="table-total-row">
            <td colspan="2" style="text-align: right; padding-right: 12px;">TOTAL</td>
            <td style="text-align: center;">${totalQty}</td>
            <td></td>
            <td style="text-align: right;">${totalTaxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td style="text-align: right; font-size: 11px;">${doc.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
          </tr>
        </tbody>
      </table>

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
            <td>${doc.items[0]?.hsn_sac || '—'}</td>
            <td>${doc.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>${doc.items[0]?.tax_rate ? (doc.items[0].tax_rate / 2) : 2.5}%</td>
            <td>${doc.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>${doc.items[0]?.tax_rate ? (doc.items[0].tax_rate / 2) : 2.5}%</td>
            <td>${doc.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            <td>${totalTaxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
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
                <td><strong>${bankName}, ${branchName}</strong></td>
              </tr>
            </table>

            <div style="font-size: 9.5px; font-weight: 800; border-top: 1px solid #000; padding-top: 4px; margin-top: 6px;">Terms and Conditions</div>
            <div style="font-size: 8.5px; line-height: 1.35; color: #111;">
              Payment 100% Advance.<br/>
              All payments to be drawn in favour of "${business?.name || 'Avadh Boring Company'}", payable at Barabanki<br/>
              This quotation is valid for 15 Days, subject to availability with our principals<br/>
              <strong>ALL SUBJECT TO BARABANKI JURISDICTION</strong><br/>
              (E. & O.E.)
            </div>
          </div>
        </div>

        <div class="bottom-right">
          <div style="font-size: 9.5px; font-weight: 700;">
            Authorised Signatory For<br/>
            <strong>${business?.name || 'AVADH BORING COMPANY'}</strong>
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