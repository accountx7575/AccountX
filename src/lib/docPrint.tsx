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
  const totalTax =
    Number(doc.cgst || 0) + Number(doc.sgst || 0) + Number(doc.igst || 0);
  const totalAmountWords = numberToWordsINR(doc.grandTotal);

  const businessName = business?.name || 'AVADH BORING COMPANY';
  const businessAddress =
    business?.address ||
    'AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001';
  const gstin = business?.gstin || '09AABPQ3096M1Z5';
  const pan =
    business?.pan ||
    (String(gstin).length >= 12 ? String(gstin).slice(2, 12) : 'AABPQ3096M');
  const phone = business?.phone || '+91 9450942418';
  const email = business?.email || 'abc.solar7575@gmail.com';
  const state = business?.state || 'Uttar Pradesh';

  const bankName = business?.bank_name || 'Canara Bank';
  const branchName = business?.bank_branch || 'Barabanki';
  const accountName = business?.bank_account_name || 'Avadh Boring Company';
  const accountNo = business?.bank_account_number || '120034396413';
  const ifsc = business?.bank_ifsc_code || 'CNRB0018631';

  const dynamicLogo = business?.stamp_url || business?.logo_url || SOLAR_HOME_LOGO;
  const dynamicSignature = business?.signature_url || null;

  const title = doc.docTitle || 'QUOTATION';
  const shipName = doc.shipToName || doc.partyName;
  const shipAddress = doc.shipToAddress || doc.partyAddress || '';
  const shipPhone = doc.shipToPhone || doc.partyPhone || '';

  const itemRows = doc.items
    .map((item, index) => {
      const taxable = Number(
        item.taxable_amount ??
          Number(item.rate || 0) * Number(item.quantity || 0),
      );
      const taxAmount = Math.max(
        0,
        Number(item.total_amount || 0) - taxable,
      );
      const half = taxAmount / 2;
      const taxCells = isInterState
        ? `<td class="num">₹ ${money(taxAmount)}</td>`
        : `<td class="num">₹ ${money(half)}</td><td class="num">₹ ${money(half)}</td>`;
      return `
          <tr class="${index % 2 === 1 ? 'alt' : ''}">
            <td class="ctr">${index + 1}</td>
            <td>${esc(item.product_name)}</td>
            <td class="ctr">${esc(item.hsn_sac || '—')}</td>
            <td class="ctr">${esc(item.quantity)} ${esc(item.unit || 'PCS')}</td>
            <td class="ctr">${esc(item.tax_rate)}%</td>
            <td class="num">₹ ${money(taxable)}</td>
            ${taxCells}
            <td class="num"><strong>₹ ${money(item.total_amount)}</strong></td>
          </tr>`;
    })
    .join('');

  const termsList = (
    doc.terms ||
    `Payment 100% Advance.
All payments to be drawn in favour of "${businessName}", payable at Barabanki.
This quotation is valid for 15 Days, subject to availability with our principals.
ALL SUBJECT TO BARABANKI JURISDICTION.
(E. & O.E.)`
  )
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`)
    .join('');

  const taxBreakRows = isInterState
    ? `<tr><td class="t-lbl">IGST (${esc(doc.items[0]?.tax_rate || 0)}%)</td><td class="t-val">₹ ${money(doc.igst)}</td></tr>`
    : `<tr><td class="t-lbl">CGST</td><td class="t-val">₹ ${money(doc.cgst)}</td></tr>
       <tr><td class="t-lbl">SGST</td><td class="t-val">₹ ${money(doc.sgst)}</td></tr>`;

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(doc.docNumber)} - ${esc(title)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1e293b; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; line-height: 1.5; }
  .doc { width: 100%; max-width: 190mm; margin: 0 auto; }
  .doc-title { text-align: center; color: #ea580c; font-size: 26px; font-weight: 800; letter-spacing: 1.5px; margin: 0 0 6mm; text-transform: uppercase; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; margin-bottom: 6mm; }
  .brand { display: flex; align-items: center; gap: 4mm; }
  .brand img { max-width: 95px; max-height: 75px; object-fit: contain; }
  .brand-name { font-size: 16px; font-weight: 800; color: #0f172a; }
  .meta { text-align: right; font-size: 11px; line-height: 1.8; white-space: nowrap; }
  .meta .k { color: #64748b; }
  .meta .v { font-weight: 800; color: #0f172a; }
  .cards { display: flex; gap: 4mm; margin-bottom: 3mm; }
  .card { flex: 1; background: #fff7ed; border: 1px solid #ffedd5; border-radius: 3mm; padding: 4mm; }
  .card h3 { margin: 0 0 2mm; font-size: 11.5px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: #ea580c; }
  .card p { margin: 1px 0; font-size: 10.5px; }
  .card .nm { font-size: 12px; font-weight: 800; color: #0f172a; margin-bottom: 1mm; }
  .card .lbl { color: #64748b; font-weight: 700; }
  .supply-bar { display: flex; gap: 10mm; font-size: 10.5px; margin: 0 0 5mm; padding: 2.5mm 4mm; border: 1px solid #ffedd5; border-radius: 2mm; }
  .supply-bar .lbl { color: #64748b; font-weight: 700; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  .items th { background: #ea580c; color: #fff; font-size: 10.5px; font-weight: 800; padding: 2.5mm 2mm; border: 1px solid #ea580c; }
  .items td { border: 1px solid #fed7aa; padding: 2mm; font-size: 10px; vertical-align: top; }
  .items tr.alt td { background: #fffaf5; }
  .num { text-align: right; white-space: nowrap; }
  .ctr { text-align: center; }
  .bottom { display: flex; gap: 5mm; align-items: flex-start; }
  .left-col { width: 55%; }
  .right-col { width: 45%; }
  .bank-card { background: #fff7ed; border: 1px solid #ffedd5; border-radius: 2mm; padding: 3.5mm; margin-bottom: 4mm; }
  .bank-card h4, .terms h4 { margin: 0 0 2mm; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; color: #ea580c; }
  .bank-card p { margin: 1px 0; font-size: 10px; }
  .bank-card .lbl { color: #64748b; font-weight: 700; }
  .terms ul { margin: 1mm 0 0; padding-left: 5mm; font-size: 10px; line-height: 1.55; }
  .sign { margin-top: 6mm; text-align: center; }
  .sign img { max-width: 170px; max-height: 65px; object-fit: contain; }
  .sign .for { font-size: 11px; font-weight: 800; color: #0b4da2; }
  .sign .prop { font-size: 12px; font-weight: 800; color: #0b4da2; text-align: right; padding-right: 8mm; }
  .sign-line { border-top: 1px solid #0f172a; padding-top: 2mm; margin-top: 2mm; font-size: 10px; font-weight: 700; }
  .tot-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .tot-table td { padding: 1.2mm 0; }
  .tot-table .t-lbl { color: #64748b; }
  .tot-table .t-val { text-align: right; font-weight: 700; color: #0f172a; white-space: nowrap; }
  .grand td { border-top: 2px solid #ea580c; padding-top: 2.5mm; font-size: 15px; font-weight: 800; color: #0f172a; }
  .words { font-style: italic; color: #64748b; font-size: 10px; margin-top: 2mm; text-align: right; }
  @media print { .doc { max-width: none; } }
</style>
</head>
<body>
<div class="doc">
  <h1 class="doc-title">${esc(title)}</h1>

  <div class="top">
    <div class="brand">
      <img src="${dynamicLogo}" alt="Company Logo" />
      <div class="brand-name">${esc(businessName)}</div>
    </div>
    <div class="meta">
      <div><span class="k">${esc(doc.docTitle || 'QUOTATION')} #:</span> <span class="v">${esc(doc.docNumber)}</span></div>
      <div><span class="k">${esc(doc.dateLabel || 'Quote Date')}:</span> <span class="v">${esc(doc.dateValue)}</span></div>
      <div><span class="k">${esc(doc.expiryLabel || 'Valid Until')}:</span> <span class="v">${esc(doc.expiryValue || '—')}</span></div>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <h3>Billed By</h3>
      <p class="nm">${esc(businessName)}</p>
      <p>${esc(businessAddress)}</p>
      <p><span class="lbl">GSTIN:</span> ${esc(gstin)}</p>
      <p><span class="lbl">PAN:</span> ${esc(pan)}</p>
      <p><span class="lbl">Phone:</span> ${esc(phone)}</p>
    </div>
    <div class="card">
      <h3>Billed To${shipName && shipName !== doc.partyName ? ' / Ship To' : ''}</h3>
      <p class="nm">${esc(doc.partyName)}</p>
      <p>${esc(doc.partyAddress || '')}</p>
      ${doc.partyGstin ? `<p><span class="lbl">GSTIN:</span> ${esc(doc.partyGstin)}</p>` : ''}
      ${doc.partyPhone ? `<p><span class="lbl">Phone:</span> ${esc(doc.partyPhone)}</p>` : ''}
      ${shipName && shipName !== doc.partyName ? `<p><span class="lbl">Ship To:</span> ${esc(shipName)}${shipAddress ? `, ${esc(shipAddress)}` : ''}${shipPhone ? ` (${esc(shipPhone)})` : ''}</p>` : ''}
    </div>
  </div>

  <div class="supply-bar">
    <div><span class="lbl">Place of Supply:</span> ${esc(doc.partyPlaceOfSupply || state)}</div>
    <div><span class="lbl">Country of Supply:</span> India</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th style="text-align: left;">Description</th>
        <th>HSN/SAC</th>
        <th>Qty</th>
        <th>GST%</th>
        <th style="text-align: right;">Taxable</th>
        ${isInterState ? '<th style="text-align: right;">IGST</th>' : '<th style="text-align: right;">CGST</th><th style="text-align: right;">SGST</th>'}
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="bottom">
    <div class="left-col">
      <div class="bank-card">
        <h4>Bank Details</h4>
        <p><span class="lbl">Bank Name:</span> ${esc(bankName)}, ${esc(branchName)}</p>
        <p><span class="lbl">Account Name:</span> ${esc(accountName)}</p>
        <p><span class="lbl">Account No:</span> ${esc(accountNo)}</p>
        <p><span class="lbl">IFSC Code:</span> ${esc(ifsc)}</p>
      </div>
      <div class="terms">
        <h4>Terms &amp; Conditions</h4>
        <ul>${termsList}</ul>
      </div>
      <div class="sign">
        ${dynamicSignature ? `<img src="${dynamicSignature}" alt="Authorised Signature" />` : `<div class="for">For ${esc(businessName)}</div><div class="prop">Prop.</div>`}
        <div class="sign-line">Authorised Signatory</div>
      </div>
    </div>
    <div class="right-col">
      <table class="tot-table">
        <tbody>
          <tr><td class="t-lbl">Sub Total</td><td class="t-val">₹ ${money(doc.subtotal)}</td></tr>
          ${taxBreakRows}
          ${doc.roundOff ? `<tr><td class="t-lbl">Round Off</td><td class="t-val">₹ ${money(doc.roundOff)}</td></tr>` : ''}
          <tr class="grand"><td>Grand Total</td><td class="t-val">₹ ${money(doc.grandTotal)}</td></tr>
        </tbody>
      </table>
      <div class="words">${esc(totalAmountWords)}</div>
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

type PdfMakeApi = {
  vfs: Record<string, string>;
  createPdf: (docDefinition: unknown) => {
    getBlob: (cb: (result: Blob) => void) => void;
  };
};

let cachedPdfMake: PdfMakeApi | null = null;

/** Lazy-load pdfmake + Roboto vfs (UMD builds, resolved via dynamic import). */
async function loadPdfMake(): Promise<PdfMakeApi> {
  if (cachedPdfMake) return cachedPdfMake;
  const [makeMod, vfsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const api =
    (makeMod as unknown as { default?: PdfMakeApi }).default ??
    (makeMod as unknown as PdfMakeApi);
  const vfs =
    (vfsMod as unknown as { default?: Record<string, string> }).default ??
    (vfsMod as unknown as Record<string, string>);
  api.vfs = vfs;
  cachedPdfMake = api;
  return api;
}

/**
 * Uploaded artwork: PNG/JPEG data URLs plus hosted https uploads
 * (e.g. Supabase storage objects). SVG artwork is redrawn as vectors
 * by solarHomeVectorLogo() instead.
 */
export function headerImageUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (/^data:image\/(png|jpe?g);/i.test(u)) return u;
  if (/^https?:\/\//i.test(u) && /\.(png|jpe?g)(\?.*)?$/i.test(u)) return u;
  return null;
}

/** Browser load check — a dead/blocked URL must fall back, never crash the PDF. */
function loadableImageUrl(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  if (url.startsWith('data:')) return Promise.resolve(url);
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Fallback Solar Home mark redrawn with native pdfmake canvas vectors
 * (sun + roof + body + panel lines + ground arc + wordmark), so the
 * header logo is never blank and stays crisp at any zoom.
 */
function solarHomeVectorLogo() {
  const s = 0.64;
  const X0 = 4; // centers the 70pt artwork inside the 78pt logo column
  const X = (x: number) => Math.round((x * s + X0) * 100) / 100;
  const pts = (list: Array<[number, number]>) =>
    list.map(([x, y]) => ({ x: X(x), y: X(y) }));
  // Ground arc: quadratic (22,55) C(55,70) (88,55), sampled to segments.
  const arc: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 12; i += 1) {
    const t = i / 12;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    arc.push({
      x: X(a * 22 + b * 55 + c * 88),
      y: X(a * 55 + b * 70 + c * 55),
    });
  }
  return {
    stack: [
      {
        canvas: [
          {
            type: 'ellipse',
            x: X(55),
            y: X(30),
            r1: X(22),
            r2: X(22),
            fillColor: '#F59E0B',
          },
          {
            type: 'polyline',
            points: pts([
              [55, 10],
              [18, 38],
              [24, 42],
              [55, 17],
              [86, 42],
              [92, 38],
            ]),
            closePath: true,
            lineColor: '#1E3A8A',
            fillColor: '#1E3A8A',
          },
          {
            type: 'polyline',
            points: pts([
              [26, 42],
              [55, 20],
              [84, 42],
              [78, 58],
              [32, 58],
            ]),
            closePath: true,
            lineColor: '#0284C7',
            fillColor: '#0284C7',
          },
          {
            type: 'line',
            x1: X(55),
            y1: X(20),
            x2: X(55),
            y2: X(58),
            lineWidth: 1.5,
            lineColor: '#FFFFFF',
          },
          {
            type: 'line',
            x1: X(38),
            y1: X(32),
            x2: X(72),
            y2: X(32),
            lineWidth: 1,
            lineColor: '#FFFFFF',
          },
          {
            type: 'line',
            x1: X(34),
            y1: X(44),
            x2: X(76),
            y2: X(44),
            lineWidth: 1,
            lineColor: '#FFFFFF',
          },
          {
            type: 'polyline',
            points: arc,
            lineWidth: 2.5,
            lineColor: '#16A34A',
            lineCap: 'round',
          },
        ],
      },
      {
        text: 'SOLAR HOME',
        bold: true,
        fontSize: 7,
        alignment: 'center',
        color: '#0F172A',
        margin: [0, 2, 0, 0],
      },
      {
        text: 'RENEWABLE ENERGY',
        bold: true,
        fontSize: 4.5,
        alignment: 'center',
        color: '#475569',
      },
    ],
  };
}

/**
 * Native-vector Om document definition for pdfmake.
 * Mirrors the Om HTML layout: 1px continuous grid, 50/50 splits,
 * 6px gaps before GST + Words, right-aligned Proprietor stamp.
 * All text is real PDF text (selectable, zoom-sharp).
 */
export type OmVectorAssets = {
  logoUrl?: string | null;
  signatureUrl?: string | null;
};

export function buildOmVectorDoc(
  business: any,
  doc: PrintableDocData,
  assets?: OmVectorAssets,
): unknown {
  const ACCENT = '#EA580C';
  const TINT = '#FFF7ED';
  const CARD_BORDER = '#FFEDD5';
  const GRID = '#FED7AA';
  const INK = '#1E293B';
  const DARK = '#0F172A';
  const MUTED = '#64748B';
  const ALTROW = '#FFFAF5';
  const STAMP_BLUE = '#0B4DA2';
  const RUPEE = '₹';

  const businessName = business?.name || 'AVADH BORING COMPANY';
  const businessAddress =
    business?.address ||
    'AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001';
  const gstin = business?.gstin || '09AABPQ3096M1Z5';
  const pan =
    business?.pan ||
    (String(gstin).length >= 12 ? String(gstin).slice(2, 12) : 'AABPQ3096M');
  const phone = business?.phone || '+91 9450942418';
  const email = business?.email || 'abc.solar7575@gmail.com';
  const state = business?.state || 'Uttar Pradesh';

  const bankName = business?.bank_name || 'Canara Bank';
  const branchName = business?.bank_branch || 'Barabanki';
  const accountName = business?.bank_account_name || 'Avadh Boring Company';
  const accountNo = business?.bank_account_number || '120034396413';
  const ifsc = business?.bank_ifsc_code || 'CNRB0018631';

  // Header mark priority (mirrors the HTML template): uploaded stamp,
  // then uploaded logo, then the redrawn Solar Home vector.
  const logoUrl =
    assets?.logoUrl !== undefined
      ? assets.logoUrl
      : (headerImageUrl(business?.stamp_url) ??
        headerImageUrl(business?.logo_url));
  const signatureUrl =
    assets?.signatureUrl !== undefined
      ? assets.signatureUrl
      : headerImageUrl(business?.signature_url);

  const title = doc.docTitle || 'QUOTATION';
  const isInterState = Number(doc.igst || 0) > 0;
  const totalAmountWords = numberToWordsINR(doc.grandTotal);

  const shipName = doc.shipToName || doc.partyName;
  const shipAddress = doc.shipToAddress || doc.partyAddress || '';
  const shipPhone = doc.shipToPhone || doc.partyPhone || '';

  const rs = (n: number) => `${RUPEE} ${money(Number(n || 0))}`;
  const em = (v: unknown) => String(v ?? '—');

  const noBox = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
  };
  const cardBox = (borderColor: string) => ({
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    hLineColor: () => borderColor,
    vLineColor: () => borderColor,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 6,
    paddingBottom: () => 6,
  });
  const itemGrid = {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    hLineColor: () => GRID,
    vLineColor: () => GRID,
    paddingLeft: () => 5,
    paddingRight: () => 5,
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };

  const cardCell = (stack: unknown[]) => ({
    stack,
    fillColor: TINT,
    margin: [0, 0, 0, 0],
  });

  const cardHeading = (text: string) => ({
    text,
    bold: true,
    fontSize: 11.5,
    color: ACCENT,
    margin: [0, 0, 0, 4],
  });

  const fieldLine = (label: string, value: string, size = 10.5) => ({
    text: [
      { text: `${label}: `, bold: true, color: MUTED },
      { text: value, color: INK },
    ],
    fontSize: size,
    lineHeight: 1.4,
  });

  const headCell = (text: string, alignment: string = 'center') => ({
    text,
    bold: true,
    fontSize: 10,
    color: '#FFFFFF',
    fillColor: ACCENT,
    alignment,
  });

  const brandBlock = {
    columns: [
      logoUrl
        ? { image: logoUrl, fit: [71, 56] }
        : solarHomeVectorLogo(),
      {
        stack: [
          { text: businessName, bold: true, fontSize: 16, color: DARK },
        ],
      },
    ],
    columnGap: 10,
  };

  const metaLine = (label: string, value: string) => ({
    text: [
      { text: `${label}: `, color: MUTED },
      { text: value, bold: true, color: DARK },
    ],
    fontSize: 11,
    alignment: 'right',
    lineHeight: 1.8,
  });

  const billedByCard = {
    table: {
      widths: ['*'],
      body: [
        [
          cardCell([
            cardHeading('Billed By'),
            {
              text: businessName,
              bold: true,
              fontSize: 12,
              color: DARK,
              margin: [0, 0, 0, 2],
            },
            { text: businessAddress, fontSize: 10.5 },
            fieldLine('GSTIN', gstin),
            fieldLine('PAN', pan),
            fieldLine('Phone', phone),
          ]),
        ],
      ],
    },
    layout: cardBox(CARD_BORDER),
  };

  const billedToLines: unknown[] = [
    cardHeading(
      shipName && shipName !== doc.partyName
        ? 'Billed To / Ship To'
        : 'Billed To',
    ),
    {
      text: doc.partyName,
      bold: true,
      fontSize: 12,
      color: DARK,
      margin: [0, 0, 0, 2],
    },
    { text: em(doc.partyAddress), fontSize: 10.5 },
  ];
  if (doc.partyGstin)
    billedToLines.push(fieldLine('GSTIN', String(doc.partyGstin)));
  if (doc.partyPhone)
    billedToLines.push(fieldLine('Phone', String(doc.partyPhone)));
  if (shipName && shipName !== doc.partyName)
    billedToLines.push(
      fieldLine(
        'Ship To',
        `${shipName}${shipAddress ? `, ${shipAddress}` : ''}${shipPhone ? ` (${shipPhone})` : ''}`,
      ),
    );

  const billedToCard = {
    table: { widths: ['*'], body: [[cardCell(billedToLines)]] },
    layout: cardBox(CARD_BORDER),
  };

  const supplyBar = {
    table: {
      widths: ['*', '*'],
      body: [
        [
          {
            text: [
              { text: 'Place of Supply: ', bold: true, color: MUTED },
              { text: em(doc.partyPlaceOfSupply || state), color: INK },
            ],
            fontSize: 10.5,
            margin: [6, 5, 6, 5],
          },
          {
            text: [
              { text: 'Country of Supply: ', bold: true, color: MUTED },
              { text: 'India', color: INK },
            ],
            fontSize: 10.5,
            margin: [6, 5, 6, 5],
          },
        ],
      ],
    },
    layout: cardBox(CARD_BORDER),
  };

  const bodyCell = (text: string, alignment: string, alt: boolean) => ({
    text,
    fontSize: 10,
    alignment,
    ...(alt ? { fillColor: ALTROW } : {}),
  });

  const itemRows = doc.items.map((item, index) => {
    const alt = index % 2 === 1;
    const taxable = Number(
      item.taxable_amount ?? Number(item.rate || 0) * Number(item.quantity || 0),
    );
    const taxAmount = Math.max(
      0,
      Number(item.total_amount || 0) - taxable,
    );
    const base = [
      bodyCell(String(index + 1), 'center', alt),
      { text: String(item.product_name || ''), fontSize: 10, ...(alt ? { fillColor: ALTROW } : {}) },
      bodyCell(em(item.hsn_sac) === '—' ? '—' : String(item.hsn_sac), 'center', alt),
      bodyCell(
        `${item.quantity ?? 0} ${item.unit || 'PCS'}`,
        'center',
        alt,
      ),
      bodyCell(`${Number(item.tax_rate || 0)}%`, 'center', alt),
      bodyCell(rs(taxable), 'right', alt),
    ];
    const taxCells = isInterState
      ? [bodyCell(rs(taxAmount), 'right', alt)]
      : [
          bodyCell(rs(taxAmount / 2), 'right', alt),
          bodyCell(rs(taxAmount / 2), 'right', alt),
        ];
    return [
      ...base,
      ...taxCells,
      {
        text: rs(item.total_amount),
        bold: true,
        fontSize: 10,
        alignment: 'right',
        ...(alt ? { fillColor: ALTROW } : {}),
      },
    ];
  });

  const itemsTable = {
    table: {
      widths: isInterState
        ? [24, '*', 46, 32, 30, 64, 60, 66]
        : [24, '*', 44, 32, 30, 64, 54, 54, 64],
      body: [
        isInterState
          ? [
              headCell('#'),
              headCell('Description', 'left'),
              headCell('HSN/SAC'),
              headCell('Qty'),
              headCell('GST%'),
              headCell('Taxable', 'right'),
              headCell('IGST', 'right'),
              headCell('Total', 'right'),
            ]
          : [
              headCell('#'),
              headCell('Description', 'left'),
              headCell('HSN/SAC'),
              headCell('Qty'),
              headCell('GST%'),
              headCell('Taxable', 'right'),
              headCell('CGST', 'right'),
              headCell('SGST', 'right'),
              headCell('Total', 'right'),
            ],
        ...itemRows,
      ],
    },
    layout: itemGrid,
  };

  const totRow = (label: string, value: string) => [
    { text: label, fontSize: 11, color: MUTED },
    { text: value, bold: true, fontSize: 11, color: DARK, alignment: 'right' },
  ];
  const totalsRows: unknown[][] = [
    totRow('Sub Total', rs(doc.subtotal)),
  ];
  if (isInterState) {
    totalsRows.push(
      totRow(`IGST (${Number(doc.items[0]?.tax_rate || 0)}%)`, rs(doc.igst)),
    );
  } else {
    totalsRows.push(totRow('CGST', rs(doc.cgst)));
    totalsRows.push(totRow('SGST', rs(doc.sgst)));
  }
  if (doc.roundOff) totalsRows.push(totRow('Round Off', rs(doc.roundOff)));

  const bankCard = {
    table: {
      widths: ['*'],
      body: [
        [
          cardCell([
            cardHeading('Bank Details'),
            fieldLine('Bank Name', `${bankName}, ${branchName}`, 10),
            fieldLine('Account Name', accountName, 10),
            fieldLine('Account No', accountNo, 10),
            fieldLine('IFSC Code', ifsc, 10),
          ]),
        ],
      ],
    },
    layout: cardBox(CARD_BORDER),
  };

  const termsItems = (
    doc.terms ||
    `Payment 100% Advance.
All payments to be drawn in favour of "${businessName}", payable at Barabanki.
This quotation is valid for 15 Days, subject to availability with our principals.
ALL SUBJECT TO BARABANKI JURISDICTION.
(E. & O.E.)`
  )
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const signatureStack = {
    stack: [
      { text: '', margin: [0, 6, 0, 0] },
      signatureUrl
        ? {
            image: signatureUrl,
            fit: [150, 65],
            alignment: 'center',
            margin: [0, 4, 0, 4],
          }
        : {
            stack: [
              {
                text: `For ${businessName}`,
                bold: true,
                fontSize: 11,
                color: STAMP_BLUE,
                alignment: 'center',
                margin: [0, 4, 0, 2],
              },
              {
                text: 'Prop.',
                bold: true,
                fontSize: 12,
                color: STAMP_BLUE,
                alignment: 'right',
                margin: [0, 0, 8, 0],
              },
            ],
          },
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 150,
            y2: 0,
            lineWidth: 1,
            lineColor: DARK,
          },
        ],
        alignment: 'center',
        margin: [0, 8, 0, 3],
      },
      {
        text: 'Authorised Signatory',
        bold: true,
        fontSize: 9,
        alignment: 'center',
        color: DARK,
      },
    ],
    alignment: 'center',
  };

  return {
    pageSize: 'A4',
    pageMargins: [28, 28, 28, 28],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10,
      color: INK,
      lineHeight: 1.5,
    },
    content: [
      {
        text: title,
        bold: true,
        fontSize: 24,
        color: ACCENT,
        alignment: 'center',
        margin: [0, 0, 0, 8],
      },
      {
        columns: [brandBlock, (
          {
            stack: [
              metaLine(`${title} #:`, em(doc.docNumber)),
              metaLine(doc.dateLabel || 'Quote Date', em(doc.dateValue)),
              metaLine(doc.expiryLabel || 'Valid Until', em(doc.expiryValue)),
            ],
          }
        )],
        columnGap: 12,
        margin: [0, 0, 0, 8],
      },
      {
        columns: [billedByCard, billedToCard],
        columnGap: 8,
        margin: [0, 0, 0, 6],
      },
      { stack: [supplyBar], margin: [0, 0, 0, 8] },
      { stack: [itemsTable], margin: [0, 0, 0, 8] },
      {
        columns: [
          {
            stack: [
              bankCard,
              {
                text: 'Terms & Conditions',
                bold: true,
                fontSize: 11.5,
                color: ACCENT,
                margin: [0, 2, 0, 4],
              },
              ...termsItems.map((t) => ({
                text: [
                  { text: '•  ', bold: true, color: ACCENT },
                  { text: String(t), color: INK },
                ],
                fontSize: 9.5,
                margin: [0, 0, 0, 2],
              })),
              signatureStack,
            ],
          },
          {
            stack: [
              {
                table: {
                  widths: ['*', 'auto'],
                  body: totalsRows,
                },
                layout: {
                  ...noBox,
                  paddingTop: () => 3,
                  paddingBottom: () => 3,
                },
              },
              {
                canvas: [
                  {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 245,
                    y2: 0,
                    lineWidth: 2,
                    lineColor: ACCENT,
                  },
                ],
                margin: [0, 4, 0, 6],
              },
              {
                columns: [
                  { text: 'Grand Total', bold: true, fontSize: 12, color: DARK },
                  {
                    text: rs(doc.grandTotal),
                    bold: true,
                    fontSize: 15,
                    color: DARK,
                    alignment: 'right',
                  },
                ],
              },
              {
                text: totalAmountWords,
                italics: true,
                fontSize: 10,
                color: MUTED,
                alignment: 'right',
                margin: [0, 4, 0, 0],
              },
            ],
          },
        ],
        columnGap: 14,
      },
    ],
  };
}

export async function renderDocSheetToPdfBlob(
  business: any,
  doc: PrintableDocData,
): Promise<Blob> {
  // Resolve uploaded artwork first (verified loadable, else vector fallback).
  const [logoUrl, signatureUrl] = await Promise.all([
    loadableImageUrl(
      headerImageUrl(business?.stamp_url) ?? headerImageUrl(business?.logo_url),
    ),
    loadableImageUrl(headerImageUrl(business?.signature_url)),
  ]);
  const docDefinition = buildOmVectorDoc(business, doc, {
    logoUrl,
    signatureUrl,
  });
  const pdfMake = await loadPdfMake();
  const blob: Blob = await new Promise<Blob>((resolve, reject) => {
    try {
      pdfMake.createPdf(docDefinition).getBlob((result: Blob) => {
        // Re-wrap to guarantee the MIME type on every browser.
        resolve(new Blob([result], { type: 'application/pdf' }));
      });
    } catch (err) {
      reject(err);
    }
  });
  return blob;
}