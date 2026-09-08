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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
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
  ];
  const b = [
    '',
    '',
    'Twenty',
    'Thirty',
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
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --primary: #1e293b;
      --accent: #f59e0b;
      --border: #e2e8f0;
      --white: #ffffff;
    }
    @media print {
      :root {
        --bg: #ffffff;
      }
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      line-height: 1.25;
      color: var(--text);
      background: var(--bg);
      margin: 0;
      padding: 8mm;
      box-sizing: border-box;
    }
    h1, h2, h3 {
      font-weight: 700;
      margin: 4px 0;
      color: var(--primary);
    }
    h1 { font-size: 14px; }
    h2 { font-size: 12px; }
    h3 { font-size: 11px; }
    .header-bar {
      border-bottom: 1px solid var(--border);
      padding-bottom: 4mm;
      margin-bottom: 4mm;
    }
    .company-info {
      margin-bottom: 4mm;
    }
    .company-info p {
      margin: 2px 0;
      font-size: 10px;
    }
    .gstin, .pan {
      font-size: 9px;
      color: var(--muted);
    }
    .party-details {
      margin-top: 4mm;
    }
    .party-details p {
      margin: 2px 0;
      font-size: 10px;
    }
    .table-responsive {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0;
    }
    .table-responsive th,
    .table-responsive td {
      border: 1px solid var(--border);
      padding: 4px 3px;
      font-size: 10px;
      line-height: 1.2;
    }
    .table-responsive th {
      background: #f8f9fa;
      font-weight: 600;
      white-space: nowrap;
    }
    .total-row {
      font-weight: 600;
      margin-top: 4px;
    }
    .notes, .terms {
      margin-top: 4px;
      font-size: 10px;
      line-height: 1.3;
    }
    @page {
      size: A4 portrait;
      margin: 8mm 8mm 8mm 8mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <h1 style="text-align: center; margin-bottom: 4mm;">${title}</h1>
  <div class="header-bar">
    <div class="company-info">
      <p>${businessName}</p>
      <p>${businessAddress}</p>
      ${gstin ? `<p>GSTIN: ${gstin}</p>` : ''}
      ${phone ? `<p>Phone: ${phone}</p>` : ''}
      ${email ? `<p>Email: ${email}</p>` : ''}
    </div>
  </div>
  ${shipName ? `<p><strong>Ship To:</strong> ${shipName}</p>` : ''}
  ${shipAddress ? `<p>${shipAddress}</p>` : ''}
  ${shipPhone ? `<p>Phone: ${shipPhone}</p>` : ''}
  ${shipPlace ? `<p>Place: ${shipPlace}</p>` : ''}
  
  <div class="table-responsive">
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>HSN/SAC</th>
          <th>Qty</th>
          <th>Rate</th>
          <th>Tax</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${doc.items.map((item, idx) => `
          <tr>
            <td>${item.product_name || ''}</td>
            ${item.hsn_sac ? `<td>${item.hsn_sac}</td>` : ''}
            <td style="text-align: center;">${item.quantity || 0}</td>
            <td style="text-align: right;">${money(item.rate || 0)}</td>
            <td style="text-align: center;">${Number(item.tax_rate || 0)}%</td>
            <td style="text-align: right;">${money(item.total_amount || 0)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  
  ${doc.notes ? `<div class="notes"><strong>Notes:</strong> ${doc.notes}</div>` : ''}
  ${doc.terms ? `<div class="terms"><strong>Terms:</strong> ${doc.terms}</div>` : ''}
  
  <div style="margin-top: 12mm; font-size: 9px; color: var(--muted); text-align: center;">
    Generated ${new Date().toLocaleString()} | Solar Home Boring Company
  </div>
</body>
</html>
`;
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

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const blob = await html2pdf()
    .from(htmlContent)
    .set({
      margin: [8, 8, 8, 8],
      filename: 'document.pdf',
      image: { type: 'png', quality: 0.98 },
      html2canvas: { enabled: false, scale: 1, letterRendering: false, background: '#fff' },
      jsPDF: { unit: 'mm', format: 'a4' },
    })
    .output('blob');

  return blob;
}