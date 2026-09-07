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

// ---------------------------------------------------------------------------
// Design tokens — deep navy + muted gold, ERP-grade (Vyapar / Tally Prime look)
// ---------------------------------------------------------------------------
const COLORS = {
  navy: '#0b2545',
  navyDark: '#081a33',
  navySoft: '#13315c',
  gold: '#b8860b',
  goldSoft: '#d4af37',
  goldBg: '#fdf6e3',
  ink: '#0f172a',
  slate: '#475569',
  slateSoft: '#64748b',
  border: '#d6dce5',
  borderSoft: '#e8ecf2',
  bgTint: '#f7f9fc',
  white: '#ffffff',
};

// Default bank details used whenever the business has no bank account on file
const DEFAULT_BANK = {
  bankName: 'Canara Bank',
  accountName: 'Avadh Boring Company',
  accountNumber: '120034396413',
  ifsc: 'CNRB0018631',
  branch: 'Barabanki',
};

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

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMoney(n: number): string {
  return (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name: string): string {
  const words = (name || 'AB').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'AB';
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function statusBadge(status: string): { bg: string; fg: string; label: string } {
  const s = (status || '').toLowerCase();
  if (s.includes('paid') || s.includes('accept') || s.includes('approved')) {
    return { bg: '#dcfce7', fg: '#15803d', label: status };
  }
  if (s.includes('overdue') || s.includes('reject') || s.includes('cancel')) {
    return { bg: '#fee2e2', fg: '#b91c1c', label: status };
  }
  if (s.includes('draft')) {
    return { bg: '#f1f5f9', fg: '#475569', label: status };
  }
  // pending / sent / open / default
  return { bg: COLORS.goldBg, fg: '#92700c', label: status || 'PENDING' };
}

function buildHtmlTemplate(business: any, doc: PrintableDocData): HTMLElement {
  const container = document.createElement('div');
  container.style.width = '794px'; // Standard A4 at 96 DPI
  container.style.backgroundColor = COLORS.white;
  container.style.color = COLORS.ink;
  container.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  container.style.fontSize = '12px';
  container.style.boxSizing = 'border-box';
  container.style.lineHeight = '1.4';
  container.style.position = 'relative';
  container.style.padding = '22px';

  const isInterState = doc.igst > 0;
  const grandTotalWords = numberToWordsINR(doc.grandTotal);
  const badge = statusBadge(doc.status);

  const businessName = escapeHtml(business?.name || 'Your Company');
  const hasBank = !!(business?.bank_account_number && String(business.bank_account_number).trim() !== '');

  const bankName = hasBank ? (business?.bank_name || '—') : DEFAULT_BANK.bankName;
  const bankAccountName = hasBank ? (business?.bank_account_name || businessName) : DEFAULT_BANK.accountName;
  const bankAccountNumber = hasBank ? business.bank_account_number : DEFAULT_BANK.accountNumber;
  const bankIfsc = hasBank ? (business?.bank_ifsc_code || '—') : DEFAULT_BANK.ifsc;
  const bankBranch = hasBank ? (business?.bank_branch || '—') : DEFAULT_BANK.branch;

  const itemRows = doc.items.map((it, idx) => `
    <tr style="background-color: ${idx % 2 === 0 ? COLORS.white : COLORS.bgTint};">
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft}; text-align: center; color: ${COLORS.slateSoft}; font-weight: 600;">${idx + 1}</td>
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft};">
        <div style="font-weight: 700; color: ${COLORS.ink}; font-size: 11.5px;">${escapeHtml(it.product_name)}</div>
      </td>
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft}; text-align: center; color: ${COLORS.slateSoft};">${escapeHtml(it.hsn_sac) || '—'}</td>
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft}; text-align: right; font-weight: 600;">${it.quantity} ${escapeHtml(it.unit) || 'PCS'}</td>
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft}; text-align: right;">${fmtMoney(it.rate)}</td>
      <td style="padding: 9px 8px; border-right: 1px solid ${COLORS.borderSoft}; text-align: right; color: ${COLORS.slateSoft};">${it.tax_rate}%</td>
      <td style="padding: 9px 8px; text-align: right; font-weight: 700; color: ${COLORS.navy};">${fmtMoney(it.total_amount)}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <!-- Decorative corner accents -->
    <div style="position: absolute; top: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg, ${COLORS.navy} 0%, ${COLORS.goldSoft} 50%, ${COLORS.navy} 100%);"></div>

    <div style="border: 1.5px solid ${COLORS.navy}; border-radius: 6px; padding: 0; margin-top: 10px; position: relative; box-shadow: 0 1px 3px rgba(11,37,69,0.08);">
      <div style="position: absolute; top: 10px; right: 14px; font-size: 8.5px; letter-spacing: 1.5px; color: ${COLORS.slateSoft}; font-weight: 700; text-transform: uppercase;">Original</div>

      <!-- ================= HEADER ================= -->
      <div style="background: linear-gradient(135deg, ${COLORS.navy} 0%, ${COLORS.navyDark} 100%); padding: 18px 20px 16px 20px; border-radius: 5px 5px 0 0; display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="width: 46px; height: 46px; min-width: 46px; border-radius: 50%; background: linear-gradient(135deg, ${COLORS.goldSoft}, ${COLORS.gold}); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; color: ${COLORS.navyDark}; border: 2px solid rgba(255,255,255,0.5);">
            ${initials(business?.name)}
          </div>
          <div>
            <div style="font-size: 18px; font-weight: 800; color: ${COLORS.white}; letter-spacing: 0.2px;">${businessName}</div>
            <div style="font-size: 10.5px; color: #c7d2e0; margin-top: 4px; line-height: 1.55; max-width: 340px;">
              ${business?.address ? `<div>${escapeHtml(business.address)}</div>` : ''}
              ${business?.city ? `<div>${escapeHtml(business.city)}${business.state ? ', ' + escapeHtml(business.state) : ''} ${escapeHtml(business.pincode) || ''}</div>` : ''}
            </div>
            <div style="display: flex; gap: 14px; margin-top: 6px; font-size: 10px; color: #e2e8f0;">
              ${business?.gstin ? `<div><span style="color:${COLORS.goldSoft}; font-weight:700;">GSTIN</span> ${escapeHtml(business.gstin)}</div>` : ''}
              ${business?.phone ? `<div><span style="color:${COLORS.goldSoft}; font-weight:700;">Ph</span> ${escapeHtml(business.phone)}</div>` : ''}
            </div>
            ${business?.email ? `<div style="font-size: 10px; color: #e2e8f0; margin-top: 2px;"><span style="color:${COLORS.goldSoft}; font-weight:700;">Email</span> ${escapeHtml(business.email)}</div>` : ''}
          </div>
        </div>

        <div style="text-align: right;">
          <div style="display: inline-block; background: rgba(255,255,255,0.12); border: 1px solid rgba(212,175,55,0.6); border-radius: 4px; padding: 5px 14px; margin-bottom: 8px;">
            <span style="font-size: 13px; font-weight: 800; color: ${COLORS.goldSoft}; letter-spacing: 1.5px; text-transform: uppercase;">${escapeHtml(doc.docTitle)}</span>
          </div>
          <table style="font-size: 10.5px; color: #e2e8f0; border-collapse: collapse; margin-left: auto;">
            <tr>
              <td style="padding: 2px 8px 2px 0; text-align: right; color: #93a3b8;">Doc No.</td>
              <td style="padding: 2px 0; text-align: right; font-weight: 800; color: ${COLORS.white};">${escapeHtml(doc.docNumber)}</td>
            </tr>
            <tr>
              <td style="padding: 2px 8px 2px 0; text-align: right; color: #93a3b8;">${escapeHtml(doc.dateLabel)}</td>
              <td style="padding: 2px 0; text-align: right; font-weight: 700; color: ${COLORS.white};">${escapeHtml(doc.dateValue)}</td>
            </tr>
            ${doc.expiryValue ? `
            <tr>
              <td style="padding: 2px 8px 2px 0; text-align: right; color: #93a3b8;">${escapeHtml(doc.expiryLabel) || 'Valid Until'}</td>
              <td style="padding: 2px 0; text-align: right; font-weight: 700; color: ${COLORS.white};">${escapeHtml(doc.expiryValue)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 2px 8px 2px 0; text-align: right; color: #93a3b8;">Place of Supply</td>
              <td style="padding: 2px 0; text-align: right; font-weight: 700; color: ${COLORS.white};">${escapeHtml(business?.state) || 'Uttar Pradesh'}</td>
            </tr>
          </table>
          <div style="margin-top: 8px;">
            <span style="display:inline-block; padding: 3px 12px; border-radius: 12px; background:${badge.bg}; color:${badge.fg}; font-size:9.5px; font-weight:800; letter-spacing: 0.5px; text-transform: uppercase;">${escapeHtml(badge.label)}</span>
          </div>
        </div>
      </div>

      <!-- thin gold divider -->
      <div style="height: 2px; background: linear-gradient(90deg, transparent, ${COLORS.goldSoft}, transparent);"></div>

      <div style="padding: 16px 20px 18px 20px;">

        <!-- ================= BILL TO ================= -->
        <div style="display: flex; gap: 12px; margin-bottom: 14px;">
          <div style="flex: 1; background-color: ${COLORS.bgTint}; border: 1px solid ${COLORS.border}; border-left: 3px solid ${COLORS.gold}; border-radius: 4px; padding: 10px 14px;">
            <div style="font-size: 9.5px; font-weight: 800; color: ${COLORS.navy}; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 5px;">${escapeHtml(doc.partyLabel) || 'Bill To'}</div>
            <div style="font-size: 13.5px; font-weight: 800; color: ${COLORS.ink};">${escapeHtml(doc.partyName)}</div>
            ${doc.partyAddress ? `<div style="font-size: 10.5px; color: ${COLORS.slate}; margin-top: 3px;">${escapeHtml(doc.partyAddress)}</div>` : ''}
            <div style="display: flex; gap: 18px; font-size: 10.5px; color: ${COLORS.slate}; margin-top: 5px;">
              ${doc.partyGstin ? `<div><strong style="color:${COLORS.navy};">GSTIN</strong> ${escapeHtml(doc.partyGstin)}</div>` : ''}
              ${doc.partyPhone ? `<div><strong style="color:${COLORS.navy};">Phone</strong> ${escapeHtml(doc.partyPhone)}</div>` : ''}
            </div>
          </div>
        </div>

        <!-- ================= ITEMS TABLE ================= -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; border: 1px solid ${COLORS.navy}; border-radius: 4px; overflow: hidden;">
          <thead>
            <tr style="background: linear-gradient(135deg, ${COLORS.navy}, ${COLORS.navySoft}); color: ${COLORS.white};">
              <th style="padding: 8px 6px; text-align: center; width: 28px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">#</th>
              <th style="padding: 8px 6px; text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">Item & Description</th>
              <th style="padding: 8px 6px; text-align: center; width: 58px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">HSN</th>
              <th style="padding: 8px 6px; text-align: right; width: 62px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">Qty</th>
              <th style="padding: 8px 6px; text-align: right; width: 88px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">Rate (₹)</th>
              <th style="padding: 8px 6px; text-align: right; width: 48px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; border-right: 1px solid rgba(255,255,255,0.15);">Tax %</th>
              <th style="padding: 8px 6px; text-align: right; width: 98px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
        </table>

        <!-- ================= AMOUNT IN WORDS + TOTALS ================= -->
        <div style="display: flex; gap: 12px; margin-bottom: 14px; align-items: stretch;">
          <div style="flex: 1.3; display: flex; flex-direction: column; gap: 8px;">
            <div style="border: 1px solid ${COLORS.border}; border-radius: 4px; padding: 9px 12px; background-color: ${COLORS.goldBg};">
              <span style="font-size: 9.5px; font-weight: 800; color: ${COLORS.gold}; text-transform: uppercase; letter-spacing: 0.6px;">Amount Chargeable (in Words)</span>
              <div style="font-size: 12px; font-weight: 800; color: ${COLORS.navy}; margin-top: 3px;">${grandTotalWords}</div>
            </div>

            <!-- GST Breakup Table -->
            <div style="border: 1px solid ${COLORS.border}; border-radius: 4px; overflow: hidden; flex: 1;">
              <table style="width: 100%; height: 100%; border-collapse: collapse; font-size: 10px;">
                <thead>
                  <tr style="background-color: ${COLORS.bgTint}; color: ${COLORS.navy}; font-weight: 800;">
                    <th style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border}; text-align: left;">Tax Type</th>
                    <th style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; border-bottom: 1px solid ${COLORS.border}; text-align: right;">Taxable Amt</th>
                    <th style="padding: 5px 8px; border-bottom: 1px solid ${COLORS.border}; text-align: right;">Tax Amt</th>
                  </tr>
                </thead>
                <tbody>
                  ${isInterState ? `
                    <tr>
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; color: ${COLORS.slate};">Integrated Tax (IGST)</td>
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; text-align: right;">₹${fmtMoney(doc.taxableAmount)}</td>
                      <td style="padding: 5px 8px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.igst)}</td>
                    </tr>
                  ` : `
                    <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; color: ${COLORS.slate};">Central Tax (CGST)</td>
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; text-align: right;">₹${fmtMoney(doc.taxableAmount / 2)}</td>
                      <td style="padding: 5px 8px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.cgst)}</td>
                    </tr>
                    <tr>
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; color: ${COLORS.slate};">State Tax (SGST)</td>
                      <td style="padding: 5px 8px; border-right: 1px solid ${COLORS.border}; text-align: right;">₹${fmtMoney(doc.taxableAmount / 2)}</td>
                      <td style="padding: 5px 8px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.sgst)}</td>
                    </tr>
                  `}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Summary Box -->
          <div style="flex: 0.9; border: 1px solid ${COLORS.navy}; border-radius: 4px; overflow: hidden; height: fit-content; box-shadow: 0 1px 4px rgba(11,37,69,0.10);">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
              <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                <td style="padding: 6px 10px; color: ${COLORS.slate};">Subtotal</td>
                <td style="padding: 6px 10px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.subtotal)}</td>
              </tr>
              <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                <td style="padding: 6px 10px; color: ${COLORS.slate};">Taxable Amount</td>
                <td style="padding: 6px 10px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.taxableAmount)}</td>
              </tr>
              ${isInterState ? `
                <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                  <td style="padding: 6px 10px; color: ${COLORS.slate};">IGST</td>
                  <td style="padding: 6px 10px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.igst)}</td>
                </tr>
              ` : `
                <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                  <td style="padding: 6px 10px; color: ${COLORS.slate};">CGST</td>
                  <td style="padding: 6px 10px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.cgst)}</td>
                </tr>
                <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                  <td style="padding: 6px 10px; color: ${COLORS.slate};">SGST</td>
                  <td style="padding: 6px 10px; text-align: right; font-weight: 700;">₹${fmtMoney(doc.sgst)}</td>
                </tr>
              `}
              ${doc.roundOff ? `
                <tr style="border-bottom: 1px solid ${COLORS.borderSoft};">
                  <td style="padding: 6px 10px; color: ${COLORS.slate};">Round Off</td>
                  <td style="padding: 6px 10px; text-align: right; font-weight: 600;">₹${fmtMoney(doc.roundOff)}</td>
                </tr>
              ` : ''}
              <tr style="background: linear-gradient(135deg, ${COLORS.navy}, ${COLORS.navyDark});">
                <td style="padding: 10px; font-weight: 800; font-size: 12px; color: ${COLORS.white};">Grand Total</td>
                <td style="padding: 10px; text-align: right; font-weight: 800; font-size: 15px; color: ${COLORS.goldSoft};">₹${fmtMoney(doc.grandTotal)}</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- ================= BANK / TERMS / SIGNATURE ================= -->
        <div style="display: flex; gap: 14px; border-top: 1.5px solid ${COLORS.border}; padding-top: 12px;">
          <div style="flex: 1; padding-right: 6px;">
            <div style="font-size: 10px; font-weight: 800; color: ${COLORS.navy}; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px;">Bank Details</div>
            <table style="font-size: 10.5px; color: ${COLORS.slate}; border-collapse: collapse;">
              <tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">Bank Name</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(bankName)}</td></tr>
              <tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">Account Name</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(bankAccountName)}</td></tr>
              <tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">Account No.</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(bankAccountNumber)}</td></tr>
              <tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">IFSC Code</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(bankIfsc)}</td></tr>
              <tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">Branch</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(bankBranch)}</td></tr>
              ${business?.upi_id ? `<tr><td style="padding: 1.5px 8px 1.5px 0; color: ${COLORS.slateSoft};">UPI ID</td><td style="padding: 1.5px 0; font-weight: 700; color: ${COLORS.ink};">${escapeHtml(business.upi_id)}</td></tr>` : ''}
            </table>
          </div>

          <div style="flex: 1; padding: 0 6px; border-left: 1px solid ${COLORS.borderSoft}; padding-left: 14px;">
            <div style="font-size: 10px; font-weight: 800; color: ${COLORS.navy}; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 6px;">Terms & Conditions</div>
            <div style="color: ${COLORS.slateSoft}; font-size: 9.5px; line-height: 1.55; white-space: pre-wrap;">
              ${escapeHtml(doc.terms) || '1. Goods once sold will not be taken back.\n2. Quotation valid for 30 days.\n3. Subject to local jurisdiction.'}
            </div>
          </div>

          <div style="width: 200px; text-align: center; display: flex; flex-direction: column; justify-content: flex-end; border-left: 1px solid ${COLORS.borderSoft}; padding-left: 14px;">
            <div style="font-size: 10.5px; font-weight: 700; color: ${COLORS.ink}; margin-bottom: 44px;">
              For ${businessName}
            </div>
            <div style="border-top: 1px dashed ${COLORS.slateSoft}; padding-top: 5px; font-weight: 700; color: ${COLORS.navy}; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px;">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>

      <!-- footer strip -->
      <div style="background: linear-gradient(135deg, ${COLORS.navy}, ${COLORS.navyDark}); border-radius: 0 0 5px 5px; padding: 6px 20px; text-align: center;">
        <span style="font-size: 8.5px; color: #a9b7cc; letter-spacing: 0.4px;">This is a computer generated ${escapeHtml(doc.docTitle).toLowerCase()} and does not require a physical signature.</span>
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

export async function printDocSheet(business: any, doc: PrintableDocData): Promise<void> {
  const container = buildHtmlTemplate(business, doc);
  const printWindow = window.open('', '_blank', 'width=900,height=1200');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${doc.docNumber}</title>
        <meta charset="utf-8" />
        <style>
          @page { size: A4; margin: 10mm; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          body { margin: 0; display: flex; justify-content: center; background: #fff; }
        </style>
      </head>
      <body>${container.outerHTML}</body>
    </html>
  `);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}
