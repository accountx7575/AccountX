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