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
      const zebra = idx % 2 === 1 ? 'background-color:#F8FAFC;' : '';
      return `
        <tr style="${zebra}">
          <td style="padding:10px 10px;text-align:center;color:${SUB};border-bottom:1px solid ${LINE};vertical-align:top;">${idx + 1}</td>
          <td style="padding:10px 10px;border-bottom:1px solid ${LINE};vertical-align:top;">
            <div style="font-weight:600;color:${INK};font-size:12.5px;">${it.product_name}</div>
          </td>
          <td style="padding:10px 10px;text-align:center;color:${SUB};border-bottom:1px solid ${LINE};vertical-align:top;">${it.hsn_sac || '—'}</td>
          <td style="padding:10px 10px;text-align:right;color:${INK};border-bottom:1px solid ${LINE};vertical-align:top;white-space:nowrap;">${it.quantity} ${it.unit || 'PCS'}</td>
          <td style="padding:10px 10px;text-align:right;color:${INK};border-bottom:1px solid ${LINE};vertical-align:top;font-variant-numeric:tabular-nums;">${money(it.rate)}</td>
          <td style="padding:10px 10px;text-align:right;color:${SUB};border-bottom:1px solid ${LINE};vertical-align:top;">${it.tax_rate}%</td>
          <td style="padding:10px 10px;text-align:right;color:${INK};font-weight:700;border-bottom:1px solid ${LINE};vertical-align:top;font-variant-numeric:tabular-nums;">${money(it.total_amount)}</td>
        </tr>`;
    })
    .join('');

  const taxRowsHtml = isInterState
    ? `
      <tr>
        <td style="padding:6px 10px;color:${SUB};">Integrated Tax (IGST)</td>
        <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">₹${money(doc.igst)}</td>
      </tr>`
    : `
      <tr>
        <td style="padding:6px 10px;color:${SUB};border-bottom:1px solid ${LINE};">Central Tax (CGST)</td>
        <td style="padding:6px 10px;text-align:right;border-bottom:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount / 2)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;border-bottom:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.cgst)}</td>
      </tr>
      <tr>
        <td style="padding:6px 10px;color:${SUB};">State Tax (SGST)</td>
        <td style="padding:6px 10px;text-align:right;font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount / 2)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">₹${money(doc.sgst)}</td>
      </tr>`;

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

      <!-- ============ BILL TO ============ -->
      <div style="margin-top:20px;display:flex;justify-content:space-between;gap:16px;">
        <div style="flex:1;background:#F8FAFC;border:1px solid ${LINE};border-radius:8px;padding:14px 16px;">
          <div style="font-size:10px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">${doc.partyLabel || 'Billed to'}</div>
          <div style="font-size:14px;font-weight:700;color:${INK};">${doc.partyName}</div>
          ${doc.partyAddress ? `<div style="font-size:11.5px;color:${SUB};margin-top:4px;max-width:420px;">${doc.partyAddress}</div>` : ''}
          <div style="display:flex;gap:22px;font-size:11.5px;color:${SUB};margin-top:6px;">
            ${doc.partyGstin ? `<div><span style="color:${INK};font-weight:600;">GSTIN</span> ${doc.partyGstin}</div>` : ''}
            ${doc.partyPhone ? `<div><span style="color:${INK};font-weight:600;">Phone</span> ${doc.partyPhone}</div>` : ''}
          </div>
        </div>
        <div style="width:200px;background:#F8FAFC;border:1px solid ${LINE};border-radius:8px;padding:14px 16px;">
          <div style="font-size:10px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Place of supply</div>
          <div style="font-size:13px;font-weight:600;color:${INK};">${business.state || 'Uttar Pradesh'}</div>
        </div>
      </div>

      <!-- ============ ITEMS TABLE ============ -->
      <table style="width:100%;border-collapse:collapse;margin-top:20px;border:1px solid ${LINE};border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:${NAVY};color:#fff;">
            <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:34px;">#</th>
            <th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Item &amp; description</th>
            <th style="padding:9px 10px;text-align:center;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:68px;">HSN</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:64px;">Qty</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:90px;">Rate (₹)</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:52px;">Tax</th>
            <th style="padding:9px 10px;text-align:right;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;width:100px;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <!-- ============ WORDS + TAX + TOTAL ============ -->
      <div style="display:flex;gap:16px;margin-top:16px;align-items:stretch;">
        <div style="flex:1.35;display:flex;flex-direction:column;gap:12px;">
          <div style="border:1px solid ${LINE};border-radius:8px;padding:12px 14px;background:#FBFBFC;">
            <div style="font-size:10px;font-weight:700;color:${SUB};text-transform:uppercase;letter-spacing:0.6px;">Amount in words</div>
            <div style="font-size:12.5px;font-weight:700;color:${NAVY};margin-top:3px;">${grandTotalWords}</div>
          </div>

          <div style="border:1px solid ${LINE};border-radius:8px;overflow:hidden;">
            <table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead>
                <tr style="background:#F1F5F9;color:${SUB};">
                  <th style="padding:6px 10px;text-align:left;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;">Tax component</th>
                  <th style="padding:6px 10px;text-align:right;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;">Taxable value</th>
                  <th style="padding:6px 10px;text-align:right;font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${taxRowsHtml}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Totals summary -->
        <div style="width:230px;border:1px solid ${LINE};border-radius:8px;overflow:hidden;display:flex;flex-direction:column;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr>
              <td style="padding:7px 12px;color:${SUB};">Subtotal</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">₹${money(doc.subtotal)}</td>
            </tr>
            <tr>
              <td style="padding:7px 12px;color:${SUB};border-top:1px solid ${LINE};">Taxable amount</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;border-top:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.taxableAmount)}</td>
            </tr>
            ${isInterState ? `
            <tr>
              <td style="padding:7px 12px;color:${SUB};border-top:1px solid ${LINE};">IGST</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;border-top:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.igst)}</td>
            </tr>` : `
            <tr>
              <td style="padding:7px 12px;color:${SUB};border-top:1px solid ${LINE};">CGST</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;border-top:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.cgst)}</td>
            </tr>
            <tr>
              <td style="padding:7px 12px;color:${SUB};">SGST</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">₹${money(doc.sgst)}</td>
            </tr>`}
            ${doc.roundOff ? `
            <tr>
              <td style="padding:7px 12px;color:${SUB};border-top:1px solid ${LINE};">Round off</td>
              <td style="padding:7px 12px;text-align:right;font-weight:600;border-top:1px solid ${LINE};font-variant-numeric:tabular-nums;">₹${money(doc.roundOff)}</td>
            </tr>` : ''}
          </table>
          <div style="margin-top:auto;background:${NAVY};color:#fff;padding:11px 14px;display:flex;justify-content:space-between;align-items:baseline;">
            <span style="font-size:11.5px;font-weight:600;letter-spacing:0.3px;">Total due</span>
            <span style="font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;">₹${money(doc.grandTotal)}</span>
          </div>
        </div>
      </div>

      <!-- ============ BANK + TERMS + SIGNATURE ============ -->
      <div style="display:flex;gap:16px;margin-top:20px;padding-top:16px;border-top:1px solid ${LINE};">
        <div style="flex:1;">
          <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Bank details</div>
          <table style="font-size:11px;color:${SUB};border-collapse:collapse;">
            <tr><td style="padding:1.5px 10px 1.5px 0;">Bank</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.bank_name || '—'}</td></tr>
            <tr><td style="padding:1.5px 10px 1.5px 0;">Account no.</td><td style="padding:1.5px 0;font-weight:600;color:${INK};font-variant-numeric:tabular-nums;">${business.bank_account_number || '—'}</td></tr>
            <tr><td style="padding:1.5px 10px 1.5px 0;">IFSC</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.bank_ifsc_code || '—'}</td></tr>
            ${business.upi_id ? `<tr><td style="padding:1.5px 10px 1.5px 0;">UPI</td><td style="padding:1.5px 0;font-weight:600;color:${INK};">${business.upi_id}</td></tr>` : ''}
          </table>
        </div>

        <div style="flex:1.2;">
          <div style="font-size:10px;font-weight:700;color:${NAVY};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Terms &amp; conditions</div>
          <div style="font-size:10.5px;color:${SUB};line-height:1.55;white-space:pre-wrap;">
            ${doc.terms || 'Payment 100% advance.\nQuotation valid for 15 days.\nSubject to local jurisdiction.'}
          </div>
        </div>

        <div style="width:190px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;text-align:center;">
          <div style="font-size:11px;font-weight:600;color:${INK};margin-bottom:44px;">For ${business.name || 'Company'}</div>
          <div style="width:100%;border-top:1px dashed #98A2B3;padding-top:5px;font-size:10px;font-weight:600;color:${SUB};">Authorised signatory</div>
        </div>
      </div>

      <div style="text-align:center;margin-top:22px;font-size:9.5px;color:#98A2B3;">
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