import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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
  shipToName?: string;
  shipToAddress?: string;
  shipToPhone?: string;
  status: string;
  items: Array<{
    product_name: string;
    description?: string;
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

// Helper to convert number to Indian Currency Words
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

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#f1f5f9', fg: '#475569' },
  sent: { bg: '#e0f2fe', fg: '#0369a1' },
  accepted: { bg: '#dcfce7', fg: '#15803d' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c' },
  paid: { bg: '#dcfce7', fg: '#15803d' },
  overdue: { bg: '#fee2e2', fg: '#b91c1c' },
};

function buildHtmlTemplate(business: any, doc: PrintableDocData): HTMLElement {
  const PAGE_W = 794; // A4 @ 96dpi
  const INK = '#101828';
  const SUB = '#667085';
  const LINE = '#e4e7ec';
  const NAVY = '#0F2947';
  const GOLD = '#B4790F';

  const container = document.createElement('div');
  container.style.width = `${PAGE_W}px`;
  container.style.backgroundColor = '#ffffff';
  container.style.color = INK;
  container.style.fontFamily = '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif';
  container.style.fontSize = '12.5px';
  container.style.lineHeight = '1.5';
  container.style.boxSizing = 'border-box';
  container.style.WebkitFontSmoothing = 'antialiased';

  const isInterState = doc.igst > 0;
  const grandTotalWords = numberToWordsINR(doc.grandTotal);
  const statusKey = (doc.status || '').toLowerCase();
  const statusColor = STATUS_COLORS[statusKey] || { bg: '#f1f5f9', fg: '#475569' };

  const itemRows = doc.items
    .map((it, idx) => {
      const descLines = (it.description || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `<div style="font-size:10.5px;color:${SUB};margin-top:2px;">${l}</div>`)
        .join('');
      const taxAmount = it.total_amount - (it.taxable_amount ?? it.rate * it.quantity);
      return `
        <tr>
          <td style="padding:10px 8px;text-align:center;color:${INK};border:1px solid ${LINE};vertical-align:top;">${idx + 1}</td>
          <td style="padding:10px 8px;border:1px solid ${LINE};vertical-align:top;">
            <div style="font-weight:700;color:${INK};font-size:12px;">${it.product_name}</div>
            ${descLines}
          </td>
          <td style="padding:10px 8px;text-align:center;color:${INK};border:1px solid ${LINE};vertical-align:top;white-space:nowrap;">${it.quantity} ${it.unit || 'PCS'}</td>
          <td style="padding:10px 8px;text-align:right;color:${INK};border:1px solid ${LINE};vertical-align:top;font-variant-numeric:tabular-nums;">${money(it.rate)}</td>
          <td style="padding:10px 8px;text-align:right;color:${INK};border:1px solid ${LINE};vertical-align:top;font-variant-numeric:tabular-nums;">
            ${money(taxAmount)}<div style="font-size:9.5px;color:${SUB};">(${it.tax_rate}%)</div>
          </td>
          <td style="padding:10px 8px;text-align:right;color:${INK};font-weight:700;border:1px solid ${LINE};vertical-align:top;font-variant-numeric:tabular-nums;">${money(it.total_amount)}</td>
        </tr>`;
    })
    .join('');

  const totalQty = doc.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const totalTax = doc.igst > 0 ? doc.igst : doc.cgst + doc.sgst;

  const cgstRate = doc.taxableAmount ? ((doc.cgst / doc.taxableAmount) * 100) : 0;
  const sgstRate = doc.taxableAmount ? ((doc.sgst / doc.taxableAmount) * 100) : 0;
  const igstRate = doc.taxableAmount ? ((doc.igst / doc.taxableAmount) * 100) : 0;

  const hsnSacSet = Array.from(new Set(doc.items.map((it) => it.hsn_sac).filter(Boolean))).join(', ');

  const hsnTableHtml = isInterState
    ? `
      <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid ${LINE};">
        <thead>
          <tr style="background:#F1F5F9;color:${SUB};">
            <th style="padding:6px 8px;text-align:left;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">HSN/SAC</th>
            <th style="padding:6px 8px;text-align:right;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">Taxable value</th>
            <th style="padding:6px 8px;text-align:center;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};" colspan="2">IGST</th>
            <th style="padding:6px 8px;text-align:right;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">Total tax</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:7px 8px;border:1px solid ${LINE};color:${SUB};">${hsnSacSet || '—'}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount)}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:center;color:${SUB};">${igstRate.toFixed(0)}%</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.igst)}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">₹${money(doc.igst)}</td>
          </tr>
        </tbody>
      </table>`
    : `
      <table style="width:100%;border-collapse:collapse;font-size:11px;border:1px solid ${LINE};">
        <thead>
          <tr style="background:#F1F5F9;color:${SUB};">
            <th style="padding:6px 8px;text-align:left;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">HSN/SAC</th>
            <th style="padding:6px 8px;text-align:right;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">Taxable value</th>
            <th style="padding:6px 8px;text-align:center;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};" colspan="2">CGST</th>
            <th style="padding:6px 8px;text-align:center;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};" colspan="2">SGST</th>
            <th style="padding:6px 8px;text-align:right;font-weight:700;font-size:9.5px;text-transform:uppercase;border:1px solid ${LINE};">Total tax</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:7px 8px;border:1px solid ${LINE};color:${SUB};">${hsnSacSet || '—'}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount)}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:center;color:${SUB};">${cgstRate.toFixed(0)}%</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.cgst)}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:center;color:${SUB};">${sgstRate.toFixed(0)}%</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.sgst)}</td>
            <td style="padding:7px 8px;border:1px solid ${LINE};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">₹${money(totalTax)}</td>
          </tr>
        </tbody>
      </table>`;

  container.innerHTML = `
    <div style="padding:36px 40px 30px 40px;">

      <!-- ============ HEADER ============ -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid ${NAVY};">
        <div style="display:flex;gap:14px;">
          <div style="width:52px;height:52px;flex-shrink:0;border-radius:10px;background:${NAVY};color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;letter-spacing:0.5px;">
            ${initials(business.name || 'CO')}
          </div>
          <div>
            <div style="font-size:19px;font-weight:800;color:${INK};letter-spacing:-0.2px;">${business.name || 'Your Company'}</div>
            ${business.tagline ? `<div style="font-size:11.5px;color:${GOLD};font-weight:600;margin-top:1px;">${business.tagline}</div>` : ''}
            <div style="font-size:11px;color:${SUB};margin-top:6px;max-width:300px;">
              ${business.address ? `${business.address}` : ''}${business.city ? `, ${business.city}` : ''}${business.state ? `, ${business.state}` : ''}${business.pincode ? ` – ${business.pincode}` : ''}
            </div>
            <div style="font-size:11px;color:${SUB};margin-top:3px;">
              ${business.phone ? `${business.phone}` : ''}${business.phone && business.email ? '&nbsp;&nbsp;·&nbsp;&nbsp;' : ''}${business.email ? `${business.email}` : ''}
            </div>
            <div style="font-size:11px;color:${INK};margin-top:5px;font-weight:600;">
              GSTIN&nbsp; <span style="font-weight:700;letter-spacing:0.3px;">${business.gstin || '—'}</span>
            </div>
          </div>
        </div>

        <div style="text-align:right;flex-shrink:0;">
          <div style="display:inline-block;background:${NAVY};color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;padding:6px 14px;border-radius:5px;">
            ${(doc.docTitle || 'QUOTATION').toUpperCase()}
          </div>
          <table style="margin-top:12px;border-collapse:collapse;font-size:11.5px;">
            <tr>
              <td style="padding:2px 0;color:${SUB};text-align:right;padding-right:10px;">No.</td>
              <td style="padding:2px 0;text-align:right;font-weight:700;color:${INK};font-variant-numeric:tabular-nums;">${doc.docNumber}</td>
            </tr>
            <tr>
              <td style="padding:2px 0;color:${SUB};text-align:right;padding-right:10px;">${doc.dateLabel}</td>
              <td style="padding:2px 0;text-align:right;font-weight:600;color:${INK};">${doc.dateValue}</td>
            </tr>
            ${doc.expiryValue ? `
            <tr>
              <td style="padding:2px 0;color:${SUB};text-align:right;padding-right:10px;">${doc.expiryLabel || 'Valid until'}</td>
              <td style="padding:2px 0;text-align:right;font-weight:600;color:${INK};">${doc.expiryValue}</td>
            </tr>` : ''}
          </table>
          <div style="margin-top:10px;">
            <span style="display:inline-block;background:${statusColor.bg};color:${statusColor.fg};font-size:10px;font-weight:700;letter-spacing:0.5px;padding:4px 10px;border-radius:20px;text-transform:uppercase;">
              ${doc.status || 'draft'}
            </span>
          </div>
        </div>
      </div>

      <!-- ============ BILL TO / SHIP TO ============ -->
      <table style="width:100%;border-collapse:collapse;margin-top:18px;border:1px solid ${LINE};">
        <tr>
          <td style="width:50%;padding:12px 14px;border:1px solid ${LINE};vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">${doc.partyLabel || 'Bill to'}</div>
            <div style="font-size:13.5px;font-weight:700;color:${INK};">${doc.partyName}</div>
            ${doc.partyAddress ? `<div style="font-size:11px;color:${SUB};margin-top:4px;">Address: ${doc.partyAddress}</div>` : ''}
            ${doc.partyGstin ? `<div style="font-size:11px;color:${SUB};margin-top:2px;">GSTIN: ${doc.partyGstin}</div>` : ''}
            ${doc.partyPhone ? `<div style="font-size:11px;color:${SUB};margin-top:2px;">Mobile: ${doc.partyPhone}</div>` : ''}
          </td>
          <td style="width:50%;padding:12px 14px;border:1px solid ${LINE};vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:5px;">Ship to</div>
            <div style="font-size:13.5px;font-weight:700;color:${INK};">${doc.shipToName || doc.partyName}</div>
            ${(doc.shipToAddress || doc.partyAddress) ? `<div style="font-size:11px;color:${SUB};margin-top:4px;">Address: ${doc.shipToAddress || doc.partyAddress}</div>` : ''}
            <div style="font-size:11px;color:${SUB};margin-top:2px;">Place of supply: ${business.state || 'Uttar Pradesh'}</div>
            ${(doc.shipToPhone || doc.partyPhone) ? `<div style="font-size:11px;color:${SUB};margin-top:2px;">Mobile: ${doc.shipToPhone || doc.partyPhone}</div>` : ''}
          </td>
        </tr>
      </table>

      <!-- ============ ITEMS TABLE ============ -->
      <table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid ${LINE};">
        <thead>
          <tr style="background:${NAVY};color:#fff;">
            <th style="padding:8px 8px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:32px;border:1px solid ${NAVY};">S.No</th>
            <th style="padding:8px 8px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;border:1px solid ${NAVY};">Items</th>
            <th style="padding:8px 8px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:56px;border:1px solid ${NAVY};">Qty</th>
            <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:88px;border:1px solid ${NAVY};">Rate</th>
            <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:78px;border:1px solid ${NAVY};">Tax</th>
            <th style="padding:8px 8px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:96px;border:1px solid ${NAVY};">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
        <tfoot>
          <tr style="background:#F1F5F9;">
            <td colspan="2" style="padding:8px;text-align:right;font-weight:700;color:${INK};border:1px solid ${LINE};">Total</td>
            <td style="padding:8px;text-align:center;font-weight:700;color:${INK};border:1px solid ${LINE};">${totalQty}</td>
            <td style="border:1px solid ${LINE};"></td>
            <td style="padding:8px;text-align:right;font-weight:700;color:${INK};border:1px solid ${LINE};">₹${money(totalTax)}</td>
            <td style="padding:8px;text-align:right;font-weight:800;color:${INK};border:1px solid ${LINE};">₹${money(doc.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <!-- ============ HSN/SAC TAX SUMMARY ============ -->
      <div style="margin-top:14px;">
        ${hsnTableHtml}
      </div>

      <!-- ============ WORDS + TOTAL DUE ============ -->
      <div style="display:flex;gap:16px;margin-top:14px;align-items:stretch;">
        <div style="flex:1;border:1px solid ${LINE};padding:10px 14px;background:#FBFBFC;">
          <div style="font-size:10px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:0.6px;">Total amount (in words)</div>
          <div style="font-size:12.5px;font-weight:700;color:${NAVY};margin-top:3px;">${grandTotalWords}</div>
        </div>
        <div style="width:230px;background:${NAVY};color:#fff;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11.5px;font-weight:600;letter-spacing:0.3px;">Total due</span>
          <span style="font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;">₹${money(doc.grandTotal)}</span>
        </div>
      </div>

      <!-- ============ BANK + TERMS + SIGNATURE ============ -->
      <table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid ${LINE};">
        <tr>
          <td style="width:32%;padding:12px 14px;border:1px solid ${LINE};vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Bank details</div>
            <table style="font-size:11px;color:${SUB};border-collapse:collapse;">
              <tr><td style="padding:1.5px 10px 1.5px 0;">Name</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.bank_name || '—'}</td></tr>
              <tr><td style="padding:1.5px 10px 1.5px 0;">IFSC</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.bank_ifsc_code || '—'}</td></tr>
              <tr><td style="padding:1.5px 10px 1.5px 0;">A/c No.</td><td style="padding:1.5px 0;font-weight:600;color:${INK};font-variant-numeric:tabular-nums;">${business.bank_account_number || '—'}</td></tr>
              ${business.upi_id ? `<tr><td style="padding:1.5px 10px 1.5px 0;">UPI</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.upi_id}</td></tr>` : ''}
            </table>
          </td>
          <td style="width:38%;padding:12px 14px;border:1px solid ${LINE};vertical-align:top;">
            <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Terms &amp; conditions</div>
            <div style="font-size:10.5px;color:${SUB};line-height:1.6;white-space:pre-wrap;">
              ${doc.terms || 'Payment 100% advance.\nQuotation valid for 15 days.\nSubject to local jurisdiction.'}
            </div>
          </td>
          <td style="width:30%;padding:12px 14px;border:1px solid ${LINE};vertical-align:bottom;text-align:center;">
            <div style="font-size:11px;font-weight:600;color:${INK};margin-bottom:40px;">For ${business.name || 'Company'}</div>
            <div style="font-size:10px;font-weight:600;color:${SUB};">Authorised signatory</div>
          </td>
        </tr>
      </table>

      <div style="text-align:center;margin-top:18px;font-size:9.5px;color:#98A2B3;">
        This is a system-generated document and is valid without a physical signature unless stated otherwise.
      </div>
    </div>
  `;

  return container;
}

export async function renderDocSheetToPdfBlob(business: any, doc: PrintableDocData): Promise<Blob> {
  const container = buildHtmlTemplate(business, doc);
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '-99999px';
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2, // High resolution crisp print
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}

export async function renderDocSheetToPdf(business: any, doc: PrintableDocData): Promise<void> {
  const blob = await renderDocSheetToPdfBlob(business, doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.docNumber.replace(/\//g, '-')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}