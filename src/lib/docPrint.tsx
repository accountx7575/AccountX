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

function buildHtmlTemplate(business: any, doc: PrintableDocData): HTMLElement {
  const container = document.createElement('div');
  container.style.width = '794px'; // Standard A4 at 96 DPI
  container.style.padding = '24px';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#111827';
  container.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  container.style.fontSize = '12px';
  container.style.boxSizing = 'border-box';
  container.style.lineHeight = '1.4';

  const isInterState = doc.igst > 0;
  const grandTotalWords = numberToWordsINR(doc.grandTotal);

  container.innerHTML = `
    <div style="border: 2px solid #1e3a8a; padding: 2px;">
      <div style="border: 1px solid #1e3a8a; padding: 12px;">
        
        <!-- Header Section -->
        <div style="text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 12px;">
          <h1 style="font-size: 20px; font-weight: 800; color: #1e3a8a; margin: 0; text-transform: uppercase; letter-spacing: 1px;">${doc.docTitle}</h1>
        </div>

        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #94a3b8; padding-bottom: 12px; margin-bottom: 12px;">
          <div style="flex: 1.2; padding-right: 16px;">
            <h2 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0;">${business.name || 'Your Company'}</h2>
            <div style="font-size: 11px; color: #475569; line-height: 1.5;">
              ${business.address ? `<div>${business.address}</div>` : ''}
              ${business.city ? `<div>${business.city}, ${business.state || ''} ${business.pincode || ''}</div>` : ''}
              <div><strong>GSTIN:</strong> ${business.gstin || '—'}</div>
              ${business.phone ? `<div><strong>Mobile:</strong> ${business.phone}</div>` : ''}
              ${business.email ? `<div><strong>Email:</strong> ${business.email}</div>` : ''}
            </div>
          </div>

          <div style="flex: 0.8; border-left: 1px solid #cbd5e1; padding-left: 16px;">
            <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
              <tr>
                <td style="padding: 3px 0; color: #475569; font-weight: 600;">Document No:</td>
                <td style="padding: 3px 0; text-align: right; font-weight: 800; color: #1e3a8a;">${doc.docNumber}</td>
              </tr>
              <tr>
                <td style="padding: 3px 0; color: #475569;">${doc.dateLabel}:</td>
                <td style="padding: 3px 0; text-align: right; font-weight: 600;">${doc.dateValue}</td>
              </tr>
              ${doc.expiryValue ? `
              <tr>
                <td style="padding: 3px 0; color: #475569;">${doc.expiryLabel || 'Valid Until'}:</td>
                <td style="padding: 3px 0; text-align: right;">${doc.expiryValue}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 3px 0; color: #475569;">Place of Supply:</td>
                <td style="padding: 3px 0; text-align: right; font-weight: 600;">${business.state || 'Uttar Pradesh'}</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Bill To Section -->
        <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 10px; margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 800; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">Bill To:</div>
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">${doc.partyName}</div>
          ${doc.partyAddress ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">${doc.partyAddress}</div>` : ''}
          <div style="display: flex; gap: 20px; font-size: 11px; color: #475569; margin-top: 4px;">
            ${doc.partyGstin ? `<div><strong>GSTIN:</strong> ${doc.partyGstin}</div>` : ''}
            ${doc.partyPhone ? `<div><strong>Phone:</strong> ${doc.partyPhone}</div>` : ''}
          </div>
        </div>

        <!-- Items Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px; border: 1px solid #1e3a8a;">
          <thead>
            <tr style="background-color: #1e3a8a; color: #ffffff; text-transform: uppercase; font-size: 10px;">
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: center; width: 30px;">#</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: left;">Item & Description</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: center; width: 60px;">HSN</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: right; width: 60px;">Qty</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: right; width: 85px;">Rate (₹)</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: right; width: 50px;">Tax %</th>
              <th style="padding: 6px; border: 1px solid #1e3a8a; text-align: right; width: 95px;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${doc.items.map((it, idx) => `
              <tr style="border-bottom: 1px solid #e2e8f0; vertical-align: top;">
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1; text-align: center;">${idx + 1}</td>
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1;">
                  <strong style="color: #0f172a; font-size: 11.5px;">${it.product_name}</strong>
                </td>
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1; text-align: center; color: #64748b;">${it.hsn_sac || '—'}</td>
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1; text-align: right; font-weight: 600;">${it.quantity} ${it.unit || 'PCS'}</td>
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1; text-align: right;">${it.rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td style="padding: 8px 6px; border-right: 1px solid #cbd5e1; text-align: right;">${it.tax_rate}%</td>
                <td style="padding: 8px 6px; text-align: right; font-weight: 700; color: #0f172a;">${it.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Amount In Words & Totals Box -->
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div style="flex: 1.3; display: flex; flex-direction: column; justify-content: space-between;">
            <div style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; background-color: #f8fafc;">
              <span style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Amount in Words:</span>
              <div style="font-size: 11px; font-weight: 700; color: #1e3a8a; margin-top: 2px;">${grandTotalWords}</div>
            </div>

            <!-- GST Breakup Table -->
            <div style="margin-top: 8px; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
                <thead>
                  <tr style="background-color: #f1f5f9; color: #475569; font-weight: 700;">
                    <th style="padding: 4px 6px; border-right: 1px solid #cbd5e1; text-align: left;">Tax Type</th>
                    <th style="padding: 4px 6px; border-right: 1px solid #cbd5e1; text-align: right;">Taxable Amount</th>
                    <th style="padding: 4px 6px; text-align: right;">Tax Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${isInterState ? `
                    <tr>
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1;">Integrated Tax (IGST)</td>
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1; text-align: right;">₹${doc.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style="padding: 4px 6px; text-align: right;">₹${doc.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ` : `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1;">Central Tax (CGST)</td>
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1; text-align: right;">₹${(doc.taxableAmount / 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style="padding: 4px 6px; text-align: right;">₹${doc.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1;">State Tax (SGST)</td>
                      <td style="padding: 4px 6px; border-right: 1px solid #cbd5e1; text-align: right;">₹${(doc.taxableAmount / 2).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style="padding: 4px 6px; text-align: right;">₹${doc.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Summary Box -->
          <div style="flex: 0.9; border: 1px solid #1e3a8a; border-radius: 4px; overflow: hidden;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 5px 8px; color: #475569;">Subtotal:</td>
                <td style="padding: 5px 8px; text-align: right; font-weight: 600;">₹${doc.subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 5px 8px; color: #475569;">Taxable Amount:</td>
                <td style="padding: 5px 8px; text-align: right; font-weight: 600;">₹${doc.taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              ${isInterState ? `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 8px; color: #475569;">IGST:</td>
                  <td style="padding: 5px 8px; text-align: right; font-weight: 600;">₹${doc.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ` : `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 8px; color: #475569;">CGST:</td>
                  <td style="padding: 5px 8px; text-align: right; font-weight: 600;">₹${doc.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 8px; color: #475569;">SGST:</td>
                  <td style="padding: 5px 8px; text-align: right; font-weight: 600;">₹${doc.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              `}
              ${doc.roundOff ? `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 8px; color: #475569;">Round Off:</td>
                  <td style="padding: 5px 8px; text-align: right;">₹${doc.roundOff.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              ` : ''}
              <tr style="background-color: #1e3a8a; color: #ffffff;">
                <td style="padding: 8px; font-weight: 800; font-size: 12px;">Total (₹):</td>
                <td style="padding: 8px; text-align: right; font-weight: 800; font-size: 14px;">₹${doc.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Bank Details & Terms & Signature Box -->
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #cbd5e1; padding-top: 10px; font-size: 10.5px;">
          <div style="flex: 1; padding-right: 12px;">
            <div style="font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-bottom: 4px;">Bank Details:</div>
            <div style="color: #475569; line-height: 1.4;">
              <div><strong>Bank:</strong> ${business.bank_name || '—'}</div>
              <div><strong>A/C No:</strong> ${business.bank_account_number || '—'}</div>
              <div><strong>IFSC:</strong> ${business.bank_ifsc_code || '—'}</div>
              ${business.upi_id ? `<div><strong>UPI ID:</strong> ${business.upi_id}</div>` : ''}
            </div>

            <div style="font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin-top: 8px; margin-bottom: 2px;">Terms & Conditions:</div>
            <div style="color: #64748b; font-size: 9.5px; line-height: 1.3; white-space: pre-wrap;">
              ${doc.terms || '1. Goods once sold will not be taken back.\n2. Quotation valid for 30 days.\n3. Subject to local jurisdiction.'}
            </div>
          </div>

          <div style="width: 220px; text-align: center; display: flex; flex-direction: column; justify-content: flex-end;">
            <div style="font-size: 10.5px; font-weight: 700; color: #0f172a; margin-bottom: 50px;">
              For ${business.name || 'Company'}
            </div>
            <div style="border-top: 1px dashed #64748b; padding-top: 4px; font-weight: 600; color: #475569;">
              Authorised Signatory
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  return container;
}

export async function renderDocSheetToPdfBlob(business: any, doc: PrintableDocData): Promise<Blob> {
  const container = buildHtmlTemplate(business, doc);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2, // High resolution crisp print
      useCORS: true,
      logging: false,
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