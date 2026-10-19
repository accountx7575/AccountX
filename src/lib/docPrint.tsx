import { captureElementToPdfBlob } from '@/lib/pdfCapture';

export interface PrintableDocData {
  docTitle: string;
  docNumber: string;
  dateLabel: string;
  dateValue: string;
  expiryLabel?: string;
  expiryValue?: string | null;
  ewayBillNo?: string | null;
  vehicleNo?: string | null;
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
  /** Purchase-bill mode: Billed By = supplier, Billed To = our business,
   *  no bank card, neutral terms, no signature image/For-block. */
  isPurchaseBill?: boolean;
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
  const totalAmountWords = numberToWordsINR(doc.grandTotal);

  const businessName =
    business?.legal_name || business?.name || 'AVADH BORING COMPANY';
  const businessAddress =
    business?.address ||
    'AN-25, LAUTA BAGH, AZAD NAGR, NAWABGANJ, Barabanki, Uttar Pradesh, 225001';
  const gstin = business?.gstin || '09AABPQ3096M1Z5';
  const pan =
    business?.pan ||
    (String(gstin).length >= 12 ? String(gstin).slice(2, 12) : 'AABPQ3096M');
  const cin = business?.cin || '';
  const phone = business?.phone || '+91 9450942418';
  const email = business?.email || 'abc.solar7575@gmail.com';
  const state = business?.state || 'Uttar Pradesh';

  const bankName = business?.bank_name || 'Canara Bank';
  const accountName =
    business?.bank_account_name || business?.account_name || businessName;
  const accountNo = business?.bank_account_number || '120034396413';
  const ifsc = business?.bank_ifsc_code || 'CNRB0018631';

  const dynamicLogo =
    business?.stamp_url || business?.logo_url || null;

  const isPurchase =
    doc.isPurchaseBill === true ||
    (doc.docTitle || '').toUpperCase().includes('PURCHASE');

  const titleUpper = (doc.docTitle || '').toUpperCase();
  let headerTitle = 'TAX INVOICE / RECEIPT';
  let subTitle = 'Original for Recipient';
  if (titleUpper.includes('QUOTE') || titleUpper.includes('ESTIMATE')) {
    headerTitle = 'QUOTATION / ESTIMATE';
    subTitle = 'Commercial Quotation';
  } else if (titleUpper.includes('SALES ORDER')) {
    headerTitle = 'SALES ORDER';
    subTitle = 'Original Order Confirmation';
  } else if (titleUpper.includes('PURCHASE ORDER')) {
    headerTitle = 'PURCHASE ORDER';
    subTitle = 'Vendor Purchase Requisition';
  } else if (titleUpper.includes('PURCHASE BILL') || isPurchase) {
    headerTitle = 'PURCHASE BILL / INWARD';
    subTitle = 'Tax Inward Receipt';
  }

  const sellerName = isPurchase ? (doc.partyName || 'Supplier') : businessName;
  const sellerAddress = isPurchase ? (doc.partyAddress || '') : businessAddress;
  const sellerGstin = isPurchase ? (doc.partyGstin || '') : gstin;
  const sellerPan = isPurchase ? '' : pan;
  const sellerCin = isPurchase ? '' : cin;
  const sellerPhone = isPurchase ? (doc.partyPhone || '') : phone;
  const sellerEmail = isPurchase ? '' : email;
  const initial = (sellerName.charAt(0) || 'A').toUpperCase();

  const buyerName = isPurchase ? businessName : (doc.partyName || 'Customer');
  const buyerAddress = isPurchase ? businessAddress : (doc.partyAddress || '');
  const buyerGstin = isPurchase ? gstin : (doc.partyGstin || '');
  const buyerPan = isPurchase ? pan : '';
  const buyerPhone = isPurchase ? phone : (doc.partyPhone || '');
  const buyerEmail = isPurchase ? email : '';

  const itemRows = doc.items
    .map((item, index) => {
      const taxable = Number(
        item.taxable_amount ??
          Number(item.rate || 0) * Number(item.quantity || 0),
      );
      return `
          <tr>
            <td class="ctr" style="color: #94a3b8;">${index + 1}</td>
            <td><strong>${esc(item.product_name)}</strong></td>
            <td class="ctr">${esc(item.hsn_sac || '—')}</td>
            <td class="ctr"><strong>${esc(item.quantity)} ${esc(item.unit || '')}</strong></td>
            <td class="num">₹ ${money(item.rate)}</td>
            <td class="ctr">${esc(item.tax_rate)}%</td>
            <td class="num"><strong>₹ ${money(item.total_amount)}</strong></td>
          </tr>`;
    })
    .join('');

  const termsList = (
    doc.terms ||
    (isPurchase
      ? `Goods received are subject to inspection and acceptance as per the purchase order.
Please quote this bill number in all future correspondence.
This is a computer-generated document and requires no physical signature.`
      : `Goods once sold will not be taken back or exchanged.
All payments to be drawn in favour of "${businessName}".
Redemption / delivery is subject to agreed operational timelines.
This is a computer-generated document and requires no physical signature.`)
  )
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<li>${esc(t)}</li>`)
    .join('');

  const taxBreakRows = isInterState
    ? `<tr><td class="t-lbl">Integrated GST (IGST)</td><td class="t-val">₹ ${money(doc.igst)}</td></tr>`
    : `<tr><td class="t-lbl">Central GST (CGST)</td><td class="t-val">₹ ${money(doc.cgst)}</td></tr>
       <tr><td class="t-lbl">State GST (SGST)</td><td class="t-val">₹ ${money(doc.sgst)}</td></tr>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(doc.docNumber)} - ${esc(headerTitle)}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #fff; color: #1e293b; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11px; line-height: 1.5; }
  .doc { width: 100%; max-width: 194mm; margin: 0 auto; padding: 4mm 6mm; box-sizing: border-box; background: #ffffff; color: #1e293b; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11px; line-height: 1.5; }
  
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; border-bottom: 2px solid #0f172a; padding-bottom: 4mm; }
  .brand-block { display: flex; align-items: center; gap: 3mm; }
  .brand-logo { max-height: 40px; max-width: 130px; object-fit: contain; border-radius: 4px; }
  .brand-badge { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: #6d28d9; color: #ffffff; font-weight: 900; font-size: 15px; }
  .brand-name { font-size: 20px; font-weight: 900; color: #0f172a; letter-spacing: -0.5px; }
  .brand-address { font-size: 10px; color: #475569; max-width: 380px; margin-top: 1mm; line-height: 1.35; white-space: pre-line; }
  .brand-tags { display: flex; flex-wrap: wrap; gap: 3.5mm; margin-top: 1.5mm; font-size: 9.5px; color: #64748b; font-weight: 500; }
  .brand-tags strong { color: #334155; }
  .brand-contact { font-size: 9.5px; color: #64748b; margin-top: 0.5mm; }
  
  .meta-block { text-align: right; shrink-0; }
  .doc-pill { display: inline-block; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px 10px; text-align: center; }
  .doc-pill-title { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; color: #0f172a; display: block; }
  .doc-pill-sub { font-size: 8.5px; font-weight: 700; color: #6d28d9; display: block; }
  .meta-lines { margin-top: 2.5mm; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10.5px; line-height: 1.55; }
  .meta-lines span.lbl { font-family: ui-sans-serif, system-ui; color: #64748b; }
  .meta-lines strong { color: #0f172a; font-size: 11px; }

  .details-card { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 4mm 0; padding: 3.5mm 4.5mm; border-radius: 10px; background: rgba(248, 250, 252, 0.85); border: 1px solid #e2e8f0; }
  .details-col-left { }
  .details-col-right { border-left: 1px solid #e2e8f0; padding-left: 4.5mm; }
  .card-sec-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin: 0 0 1mm; }
  .party-name { font-size: 12.5px; font-weight: 900; color: #0f172a; margin: 0; }
  .gstin-pill { display: inline-flex; align-items: center; padding: 1.5px 5px; border-radius: 4px; background: #f5f3ff; border: 1px solid #ddd6fe; color: #5b21b6; font-family: ui-monospace, monospace; font-size: 9px; font-weight: 700; margin-top: 1mm; }
  .pan-pill { display: inline-flex; align-items: center; padding: 1.5px 5px; border-radius: 4px; background: #f1f5f9; color: #334155; font-family: ui-monospace, monospace; font-size: 9px; font-weight: 600; margin-left: 1.5mm; }
  .party-desc { font-size: 10px; color: #475569; margin: 0.8mm 0 0; }

  .table-wrap { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 4mm; }
  table.items { width: 100%; border-collapse: collapse; text-align: left; font-size: 10.5px; }
  table.items thead { background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  table.items th { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; padding: 2.5mm 3mm; }
  table.items td { padding: 2.2mm 3mm; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .num { text-align: right; font-family: ui-monospace, monospace; }
  .ctr { text-align: center; font-family: ui-monospace, monospace; }

  .totals-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; padding: 1mm 0 4mm; border-bottom: 1px solid #e2e8f0; }
  .words-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3mm; }
  .words-title { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 1mm; }
  .words-val { font-size: 10.5px; font-weight: 800; font-style: italic; color: #0f172a; }
  .note-block { font-size: 9.5px; color: #64748b; margin-top: 1.5mm; }
  .tot-table { width: 100%; font-size: 10.5px; border-collapse: collapse; font-family: ui-monospace, monospace; }
  .tot-table td { padding: 0.8mm 0; }
  .tot-table .t-lbl { font-family: ui-sans-serif, system-ui; color: #64748b; }
  .tot-table .t-val { text-align: right; color: #0f172a; }
  .grand-pill { background: rgba(245, 243, 255, 0.7); border: 1px solid #ddd6fe; border-radius: 8px; padding: 2.5mm 3.5mm; display: flex; justify-content: space-between; align-items: center; margin-top: 2mm; }
  .grand-lbl { font-size: 11.5px; font-weight: 900; color: #2e1065; font-family: ui-sans-serif, system-ui; }
  .grand-val { font-size: 13.5px; font-weight: 900; color: #4c1d95; font-family: ui-monospace, monospace; }

  .footer-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 5mm; padding-top: 4mm; }
  .terms-sec { max-width: 380px; font-size: 9px; color: #64748b; }
  .terms-sec strong { color: #334155; font-size: 9.5px; }
  .terms-sec ul { margin: 1mm 0 0; padding-left: 4mm; line-height: 1.45; }
  .sign-box { border: 1px dashed #cbd5e1; background: rgba(248, 250, 252, 0.6); border-radius: 10px; padding: 3mm 4mm; text-align: center; min-width: 180px; }
  .sign-for { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; }
  .sign-badge { display: flex; align-items: center; justify-content: center; gap: 4px; color: #047857; margin: 1.5mm 0; font-size: 9px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; }
  .sign-line { border-top: 1px solid #e2e8f0; padding-top: 1mm; font-size: 9px; font-weight: 800; color: #1e293b; }
</style>
</head>
<body>
<div class="doc">
  <!-- 1. Header Section -->
  <div class="header-row">
    <div>
      <div class="brand-block">
        ${dynamicLogo ? `<img src="${dynamicLogo}" alt="Logo" class="brand-logo" />` : `<span class="brand-badge">${initial}</span>`}
        <span class="brand-name">${esc(sellerName)}</span>
      </div>
      <p class="brand-address">${esc(sellerAddress)}</p>
      <div class="brand-tags">
        ${sellerGstin ? `<span><strong>GSTIN:</strong> ${esc(sellerGstin)}</span>` : ''}
        ${sellerPan ? `<span><strong>PAN:</strong> ${esc(sellerPan)}</span>` : ''}
        ${sellerCin ? `<span><strong>CIN:</strong> ${esc(sellerCin)}</span>` : ''}
      </div>
      ${sellerEmail || sellerPhone ? `<p class="brand-contact">${sellerEmail ? `Support: <strong>${esc(sellerEmail)}</strong>` : ''} ${sellerPhone ? `| Phone: <strong>${esc(sellerPhone)}</strong>` : ''}</p>` : ''}
    </div>

    <!-- Meta Pill Heading -->
    <div class="meta-block">
      <div class="doc-pill">
        <span class="doc-pill-title">${esc(headerTitle)}</span>
        <span class="doc-pill-sub">${esc(subTitle)}</span>
      </div>
      <div class="meta-lines">
        <div><span class="lbl">Number:</span> <strong>${esc(doc.docNumber)}</strong></div>
        <div><span class="lbl">Date:</span> <strong>${esc(doc.dateValue)}</strong></div>
        ${doc.expiryValue ? `<div><span class="lbl">${esc(doc.expiryLabel || 'Valid Until')}:</span> <strong>${esc(doc.expiryValue)}</strong></div>` : ''}
        <div><span class="lbl">Place of Supply:</span> <strong>${esc(doc.partyPlaceOfSupply || state)}</strong></div>
        <div><span class="lbl">Supply Type:</span> <strong>${isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}</strong></div>
        <div><span class="lbl">Reverse Charge:</span> <strong>No</strong></div>
      </div>
    </div>
  </div>

  <!-- 2. Billed Details Card -->
  <div class="details-card">
    <div class="details-col-left">
      <p class="card-sec-title">${isPurchase ? 'BILLED BY (SUPPLIER DETAILS)' : 'BILLED TO (CUSTOMER DETAILS)'}</p>
      <p class="party-name">${esc(isPurchase ? sellerName : buyerName)}</p>
      ${(isPurchase ? sellerGstin : buyerGstin) ? `<div><span class="gstin-pill">GSTIN: ${esc(isPurchase ? sellerGstin : buyerGstin)}</span>${(isPurchase ? sellerPan : buyerPan) ? `<span class="pan-pill">PAN: ${esc(isPurchase ? sellerPan : buyerPan)}</span>` : ''}</div>` : ''}
      ${(isPurchase ? sellerEmail : buyerEmail) ? `<p class="party-desc">${esc(isPurchase ? sellerEmail : buyerEmail)}</p>` : ''}
      ${(isPurchase ? sellerPhone : buyerPhone) ? `<p class="party-desc">${esc(isPurchase ? sellerPhone : buyerPhone)}</p>` : ''}
      ${(isPurchase ? sellerAddress : buyerAddress) ? `<p class="party-desc">${esc(isPurchase ? sellerAddress : buyerAddress)}</p>` : ''}
    </div>
    <div class="details-col-right">
      ${isPurchase ? `
      <p class="card-sec-title">BILLED TO (OUR BUSINESS DETAILS)</p>
      <p class="party-name">${esc(buyerName)}</p>
      ${buyerGstin ? `<div><span class="gstin-pill">GSTIN: ${esc(buyerGstin)}</span>${buyerPan ? `<span class="pan-pill">PAN: ${esc(buyerPan)}</span>` : ''}</div>` : ''}
      ${buyerEmail ? `<p class="party-desc">${esc(buyerEmail)}</p>` : ''}
      ${buyerPhone ? `<p class="party-desc">${esc(buyerPhone)}</p>` : ''}
      ${buyerAddress ? `<p class="party-desc">${esc(buyerAddress)}</p>` : ''}
      ${doc.ewayBillNo ? `<p style="margin: 1.5mm 0 0.5mm; font-size: 10px;"><span style="color: #64748b;">e-Way Bill No:</span> <strong>${esc(doc.ewayBillNo)}</strong></p>` : ''}
      ${doc.vehicleNo ? `<p style="margin: 0.5mm 0; font-size: 10px;"><span style="color: #64748b;">Vehicle No:</span> <strong>${esc(doc.vehicleNo)}</strong></p>` : ''}
      ` : `
      <p class="card-sec-title">Payment &amp; Terms</p>
      ${doc.ewayBillNo ? `<p style="margin: 0.5mm 0; font-size: 10px;"><span style="color: #64748b;">e-Way Bill No:</span> <strong>${esc(doc.ewayBillNo)}</strong></p>` : ''}
      ${doc.vehicleNo ? `<p style="margin: 0.5mm 0; font-size: 10px;"><span style="color: #64748b;">Vehicle No:</span> <strong>${esc(doc.vehicleNo)}</strong></p>` : ''}
      <p style="margin: 0.5mm 0; font-size: 10px;"><span style="color: #64748b;">Payment Mode:</span> <strong>Bank / UPI / Credit</strong></p>
      ${bankName ? `
      <div style="margin-top: 1.5mm; padding-top: 1.5mm; border-top: 1px solid #e2e8f0; font-size: 9.5px; line-height: 1.45;">
        <span style="color: #94a3b8; font-weight: 800; text-transform: uppercase;">Bank Account Details:</span><br/>
        <span style="color: #64748b;">Bank:</span> <strong>${esc(bankName)}</strong><br/>
        <span style="color: #64748b;">A/C Name:</span> <strong>${esc(accountName)}</strong><br/>
        <span style="color: #64748b;">A/C:</span> <strong>${esc(accountNo)}</strong><br/>
        <span style="color: #64748b;">IFSC:</span> <strong>${esc(ifsc)}</strong>
      </div>
      ` : ''}
      `}
    </div>
  </div>

  <!-- 3. Line Items Table -->
  <div class="table-wrap">
    <table class="items">
      <thead>
        <tr>
          <th style="width: 28px; text-align: center;">#</th>
          <th>Item Description</th>
          <th style="width: 80px; text-align: center;">HSN/SAC</th>
          <th style="width: 60px; text-align: center;">Qty</th>
          <th style="width: 80px; text-align: right;">Unit Rate (₹)</th>
          <th style="width: 65px; text-align: center;">Tax (GST)</th>
          <th style="width: 95px; text-align: right;">Total (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  </div>

  <!-- 4. Totals Grid -->
  <div class="totals-row">
    <div>
      <div class="words-card">
        <div class="words-title">Amount Chargeable (in words)</div>
        <div class="words-val">${esc(totalAmountWords)}</div>
      </div>
      ${doc.notes ? `<div class="note-block"><strong>Notes:</strong> ${esc(doc.notes)}</div>` : ''}
    </div>
    <div>
      <table class="tot-table">
        <tbody>
          <tr><td class="t-lbl">Subtotal (Taxable Value):</td><td class="t-val">₹ ${money(doc.subtotal)}</td></tr>
          ${taxBreakRows}
          ${doc.roundOff ? `<tr><td class="t-lbl">Round Off:</td><td class="t-val">₹ ${money(doc.roundOff)}</td></tr>` : ''}
        </tbody>
      </table>
      <div class="grand-pill">
        <span class="grand-lbl">Grand Total (INR):</span>
        <span class="grand-val">₹ ${money(doc.grandTotal)}</span>
      </div>
    </div>
  </div>

  <!-- 5. Footer & Signatory -->
  <div class="footer-row">
    <div class="terms-sec">
      <strong>Terms &amp; Conditions:</strong>
      <ul>${termsList}</ul>
    </div>
    <div class="sign-box">
      <div class="sign-for">${isPurchase ? 'For ' + esc(buyerName) : 'For ' + esc(sellerName)}</div>
      <div class="sign-badge">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
        ${isPurchase ? 'VERIFIED &amp; RECEIVED' : 'DIGITALLY AUTHORIZED'}
      </div>
      <div class="sign-line">${isPurchase ? 'Received By / Verified By' : 'Authorized Signatory'}</div>
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

  const old = document.getElementById('accountx-doc-print-iframe');
  if (old) old.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'accountx-doc-print-iframe';
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
    try {
      iframe.contentWindow?.print();
    } catch {
      window.print();
    }

    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 2500);
  }, 400);
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
  const ACCENT = '#6D28D9';
  const TINT = '#F8FAFC';
  const INK = '#1E293B';
  const DARK = '#0F172A';
  const MUTED = '#64748B';
  const ROW_EVEN = '#FFFFFF';
  const ROW_ODD = '#F8FAFC';
  const STAMP_BLUE = '#047857';
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

  // Purchase-bill mode swaps the sales-side party assignment. Default off —
  // every other caller renders byte-identical output.
  const isPurchase = doc.isPurchaseBill === true;

  const noBox = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 0,
    paddingRight: () => 0,
    paddingTop: () => 0,
    paddingBottom: () => 0,
  };
  // Soft containers: peach fill, zero border lines.
  const cardPad = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 7,
    paddingRight: () => 7,
    paddingTop: () => 7,
    paddingBottom: () => 7,
  };
  // Items grid: orange header bar only — borderless rows, generous padding.
  const itemGrid = {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 4,
    paddingBottom: () => 4,
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

  // Logo only — company details already live in Billed By.
  const brandBlock = logoUrl
    ? { image: logoUrl, fit: [71, 56] }
    : solarHomeVectorLogo();

  const metaLine = (label: string, value: string) => ({
    text: [
      { text: `${label}: `, color: MUTED },
      { text: value, bold: true, color: DARK },
    ],
    fontSize: 11,
    alignment: 'right',
    lineHeight: 1.6,
  });

  const billedByLines: unknown[] = isPurchase
    ? [
        cardHeading('Billed By'),
        {
          text: doc.partyName,
          bold: true,
          fontSize: 12,
          color: DARK,
          margin: [0, 0, 0, 2],
        },
        { text: em(doc.partyAddress), fontSize: 10.5 },
        ...(doc.partyGstin ? [fieldLine('GSTIN', String(doc.partyGstin))] : []),
        ...(doc.partyPhone ? [fieldLine('Phone', String(doc.partyPhone))] : []),
      ]
    : [
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
      ];

  const billedToLines: unknown[] = isPurchase
    ? [
        cardHeading('Billed To'),
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
        fieldLine('Place of Supply', state),
        fieldLine('Country of Supply', 'India'),
      ]
    : [
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
  if (!isPurchase) {
    if (doc.partyGstin)
      billedToLines.push(fieldLine('GSTIN', String(doc.partyGstin)));
    if (doc.partyPhone)
      billedToLines.push(fieldLine('Phone', String(doc.partyPhone)));
    if (doc.partyPlaceOfSupply || state)
      billedToLines.push(fieldLine('Place of Supply', em(doc.partyPlaceOfSupply || state)));
    billedToLines.push(fieldLine('Country of Supply', 'India'));
    if (shipName && shipName !== doc.partyName)
      billedToLines.push(
        fieldLine(
          'Ship To',
          `${shipName}${shipAddress ? `, ${shipAddress}` : ''}${shipPhone ? ` (${shipPhone})` : ''}`,
        ),
      );
  }

  // One shared row: both cells stretch to the same height and each
  // cell's peach fill covers its full (equal) height.
  const partyCards = {
    table: {
      widths: ['*', 8, '*'],
      body: [
        [
          { ...cardCell(billedByLines), margin: [7, 7, 7, 7] },
          '',
          { ...cardCell(billedToLines), margin: [7, 7, 7, 7] },
        ],
      ],
    },
    layout: noBox,
    margin: [0, 0, 0, 6],
  };

  const bodyCell = (text: string, alignment: string, alt: boolean) => ({
    text,
    fontSize: 10,
    alignment,
    fillColor: alt ? ROW_ODD : ROW_EVEN,
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
      { text: String(item.product_name || ''), fontSize: 10, fillColor: alt ? ROW_ODD : ROW_EVEN },
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
      : [];
    return [
      ...base,
      ...taxCells,
      {
        text: rs(item.total_amount),
        bold: true,
        fontSize: 10,
        alignment: 'right',
        fillColor: alt ? ROW_ODD : ROW_EVEN,
      },
    ];
  });

  const itemsTable = {
    table: {
      widths: isInterState
        ? [20, '*', 36, 30, 22, 60, 60, 64]
        : [20, '*', 36, 32, 24, 62, 66],
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
    layout: cardPad,
  };

  const termsItems = (
    doc.terms ||
    (isPurchase
      ? `Goods received are subject to inspection and acceptance as per the purchase order.
Please quote this bill number in all future correspondence.
ALL SUBJECT TO ${state.toUpperCase()} JURISDICTION.
(E. & O.E.)`
      : `Payment 100% Advance.
All payments to be drawn in favour of "${businessName}", payable at Barabanki.
This quotation is valid for 15 Days, subject to availability with our principals.
ALL SUBJECT TO BARABANKI JURISDICTION.
(E. & O.E.)`)
  )
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  const signatureStack = isPurchase
    ? {
        stack: [
          { text: '', margin: [0, 4, 0, 0] },
          {
            text: 'Received By / Verified By',
            bold: true,
            fontSize: 11,
            color: DARK,
            alignment: 'center',
            margin: [0, 4, 0, 2],
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
            margin: [0, 6, 0, 3],
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
      }
    : {
    stack: [
      { text: '', margin: [0, 4, 0, 0] },
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
        margin: [0, 6, 0, 3],
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
    pageMargins: [26, 26, 26, 26],
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
        decoration: 'underline',
        decorationColor: ACCENT,
        margin: [0, 0, 0, 8],
      },
      {
        columns: [brandBlock, (
          {
            stack: [
              metaLine(`${title} #:`, em(doc.docNumber)),
              metaLine(doc.dateLabel || 'Quote Date', em(doc.dateValue)),
              metaLine(doc.expiryLabel || 'Valid Until', em(doc.expiryValue)),
              ...(doc.ewayBillNo ? [metaLine('e-Way Bill No', em(doc.ewayBillNo))] : []),
              ...(doc.vehicleNo ? [metaLine('Vehicle No', em(doc.vehicleNo))] : []),
            ],
          }
        )],
        columnGap: 12,
        margin: [0, 0, 0, 6],
      },
      partyCards,
      { stack: [itemsTable], margin: [0, 0, 0, 6] },
      {
        columns: [
          {
            stack: [
              ...(isPurchase ? [] : [bankCard]),
              {
                text: 'Terms & Conditions',
                bold: true,
                fontSize: 11.5,
                color: ACCENT,
                margin: [0, 2, 0, 4],
              },
              ...termsItems.map((t, idx) => ({
                text: [
                  { text: `${idx + 1}.  `, bold: true, color: ACCENT },
                  { text: String(t), color: INK },
                ],
                fontSize: 9,
                margin: [0, 0, 0, 1.5],
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
                  paddingTop: () => 2,
                  paddingBottom: () => 2,
                },
              },
              // Full-width rule: single star-width cell, bottom border only —
              // spans the whole summary block to the margin edge.
              {
                table: {
                  widths: ['*'],
                  body: [[{ text: '', fontSize: 2 }]],
                },
                layout: {
                  hLineWidth: (i: number) => (i === 1 ? 2 : 0),
                  vLineWidth: () => 0,
                  hLineColor: () => ACCENT,
                  paddingLeft: () => 0,
                  paddingRight: () => 0,
                  paddingTop: () => 0,
                  paddingBottom: () => 0,
                },
                margin: [0, 3, 0, 4],
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
                margin: [0, 2, 0, 0],
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
  const htmlContent = generateOmStyleHtml(business, doc);

  const host = document.createElement('div');
  host.id = 'accountx-pdf-capture-host';
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-9999;';
  host.innerHTML = htmlContent;
  document.body.appendChild(host);

  try {
    const images = Array.from(host.querySelectorAll('img'));
    if (images.length > 0) {
      await Promise.all(
        images.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) resolve();
              else {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }
            })
        )
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 150));

    const target = (host.querySelector('.doc') as HTMLElement) || host;
    const blob = await captureElementToPdfBlob(target);
    return blob;
  } finally {
    if (document.body.contains(host)) {
      document.body.removeChild(host);
    }
  }
}