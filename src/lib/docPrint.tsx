import { createRoot } from 'react-dom/client';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { captureElementToPdf, captureElementToPdfBlob } from '@/lib/pdfCapture';
import type { Business } from '@/types/db';

type DocItemRow = {
  product_name: string;
  hsn_sac: string | null;
  quantity: number;
  unit: string;
  rate: number;
  tax_rate: number;
  taxable_amount: number;
  total_amount: number;
};

export type PrintableDocData = {
  businessName: string;
  gstin?: string | null;
  docTitle: string;
  docNumber: string;
  dateLabel: string;
  dateValue: string;
  expiryLabel?: string;
  expiryValue?: string | null;
  partyLabel: string;
  partyName: string;
  status: string;
  items: DocItemRow[];
  subtotal: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff?: number;
  grandTotal: number;
  notes?: string | null;
  terms?: string | null;
};

export function docPdfFilename(docTitle: string, docNumber: string, partyName?: string): string {
  const clean = (s: string) => (s || '').replace(/[/\\?%*:|"<>\n\r]+/g, '-').trim() || 'DOC';
  return `${clean(docTitle)}_${clean(docNumber)}_${clean(partyName || '')}.pdf`;
}

function DocSheet({ data, business }: { data: PrintableDocData; business: Business | null }) {
  const sym = '₹';
  const bankLines: Array<[string, string, boolean]> = [];
  const bn = business?.bank_name?.trim();
  const ba = business?.bank_account_number?.trim();
  const bi = business?.bank_ifsc_code?.trim();
  const upi = business?.upi_id?.trim();
  if (bn) bankLines.push(['Bank', bn, false]);
  if (ba) bankLines.push(['A/c No.', ba, true]);
  if (bi) bankLines.push(['IFSC', bi.toUpperCase(), false]);
  if (upi) bankLines.push(['UPI', upi, true]);
  const taxRows: Array<[string, number]> = (
    [
      ['CGST', data.cgst],
      ['SGST', data.sgst],
      ['IGST', data.igst],
    ] as Array<[string, number]>
  ).filter(([, v]) => Number(v) > 0);

  return (
    <div style={{ width: '794px', minHeight: '1000px', background: '#ffffff', color: '#18181b', padding: '48px 56px', fontFamily: 'ui-sans-serif, system-ui, sans-serif', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #18181b', paddingBottom: '16px' }}>
        <div>
          <p style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>{data.businessName}</p>
          {data.gstin && <p style={{ fontSize: '12px', color: '#52525b', margin: '4px 0 0' }}>GSTIN: {data.gstin}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>{data.docTitle}</p>
          <p style={{ fontSize: '12px', color: '#52525b', margin: '4px 0 0' }}>{data.docNumber}</p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '32px', marginTop: '24px' }}>
        <div>
          <p style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#71717a', margin: 0 }}>{data.partyLabel}</p>
          <p style={{ fontSize: '15px', fontWeight: 600, margin: '4px 0 0' }}>{data.partyName}</p>
        </div>
        <table style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ color: '#71717a', paddingRight: '16px', paddingTop: '2px', paddingBottom: '2px' }}>{data.dateLabel}</td><td style={{ fontWeight: 600, textAlign: 'right' }}>{data.dateValue}</td></tr>
            {data.expiryValue && (
              <tr><td style={{ color: '#71717a', paddingRight: '16px', paddingTop: '2px', paddingBottom: '2px' }}>{data.expiryLabel || 'Valid Until'}</td><td style={{ fontWeight: 600, textAlign: 'right' }}>{formatDate(data.expiryValue)}</td></tr>
            )}
            <tr><td style={{ color: '#71717a', paddingRight: '16px', paddingTop: '2px', paddingBottom: '2px' }}>Status</td><td style={{ fontWeight: 600, textAlign: 'right' }}>{data.status}</td></tr>
          </tbody>
        </table>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '28px', fontSize: '12px' }}>
        <thead>
          <tr style={{ background: '#f4f4f5', textAlign: 'left' }}>
            <th style={th}>Item</th>
            <th style={{ ...th, width: '90px' }}>HSN/SAC</th>
            <th style={{ ...th, ...right, width: '80px' }}>Qty</th>
            <th style={{ ...th, ...right, width: '90px' }}>Rate</th>
            <th style={{ ...th, ...right, width: '60px' }}>Tax %</th>
            <th style={{ ...th, ...right, width: '100px' }}>Taxable</th>
            <th style={{ ...th, ...right, width: '110px' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e4e4e7' }}>
              <td style={td}>{it.product_name}</td>
              <td style={td}>{it.hsn_sac || '—'}</td>
              <td style={{ ...td, ...right }}>{formatNumber(Number(it.quantity))} {it.unit}</td>
              <td style={{ ...td, ...right }}>{formatCurrency(Number(it.rate), sym)}</td>
              <td style={{ ...td, ...right }}>{Number(it.tax_rate)}%</td>
              <td style={{ ...td, ...right }}>{formatCurrency(Number(it.taxable_amount), sym)}</td>
              <td style={{ ...td, ...right, fontWeight: 600 }}>{formatCurrency(Number(it.total_amount), sym)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
        <table style={{ fontSize: '12px', borderCollapse: 'collapse', minWidth: '280px' }}>
          <tbody>
            <tr><td style={{ color: '#71717a', padding: '3px 0' }}>Subtotal</td><td style={{ ...right, fontWeight: 600 }}>{formatCurrency(data.subtotal, sym)}</td></tr>
            <tr><td style={{ color: '#71717a', padding: '3px 0' }}>Taxable Amount</td><td style={{ ...right, fontWeight: 600 }}>{formatCurrency(data.taxableAmount, sym)}</td></tr>
            {taxRows.map(([label, v]) => (
              <tr key={label}><td style={{ color: '#71717a', padding: '3px 0' }}>{label}</td><td style={{ ...right, fontWeight: 600 }}>{formatCurrency(v, sym)}</td></tr>
            ))}
            {typeof data.roundOff === 'number' && data.roundOff !== 0 && (
              <tr><td style={{ color: '#71717a', padding: '3px 0' }}>Round Off</td><td style={{ ...right, fontWeight: 600 }}>{formatCurrency(data.roundOff, sym)}</td></tr>
            )}
            <tr>
              <td style={{ borderTop: '2px solid #18181b', paddingTop: '6px', fontWeight: 700 }}>Grand Total</td>
              <td style={{ ...right, borderTop: '2px solid #18181b', paddingTop: '6px', fontWeight: 700, fontSize: '14px' }}>{formatCurrency(data.grandTotal, sym)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {(data.notes || data.terms) && (
        <div style={{ marginTop: '32px', fontSize: '11px', color: '#3f3f46' }}>
          {data.notes && (<><p style={{ margin: 0, fontWeight: 600, color: '#71717a' }}>Notes</p><p style={{ margin: '4px 0 12px', whiteSpace: 'pre-wrap' }}>{data.notes}</p></>)}
          {data.terms && (<><p style={{ margin: 0, fontWeight: 600, color: '#71717a' }}>Terms &amp; Conditions</p><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{data.terms}</p></>)}
        </div>
      )}

      {bankLines.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717a' }}>Bank Details</p>
          <div style={{ marginTop: '6px', display: 'flex', gap: '28px', flexWrap: 'wrap', fontSize: '12px' }}>
            {bankLines.map(([label, value, mono]) => (
              <p key={label} style={{ margin: 0 }}>
                <span style={{ color: '#71717a', marginRight: '6px' }}>{label}:</span>
                <span style={mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 600 } : { fontWeight: 600 }}>{value}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: '40px', fontSize: '10px', color: '#a1a1aa', textAlign: 'center' }}>
        This is a system-generated document · Created with AccountX
      </p>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 10px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#52525b', borderBottom: '1px solid #d4d4d8' };
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };
const right: React.CSSProperties = { textAlign: 'right' };

export async function renderDocSheetToPdf(
  business: Business | null,
  data: Omit<PrintableDocData, 'businessName' | 'gstin'>
): Promise<void> {
  const full: PrintableDocData = {
    ...data,
    businessName: business?.legal_name || business?.name || 'Business',
    gstin: business?.gstin ?? null,
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;';
  document.body.appendChild(host);
  try {
    const root = createRoot(host);
    root.render(<DocSheet data={full} business={business} />);
    await new Promise((r) => setTimeout(r, 250));
    await captureElementToPdf(host.firstElementChild as HTMLElement ?? host, docPdfFilename(data.docTitle, data.docNumber, data.partyName));
    root.unmount();
  } finally {
    host.remove();
  }
}

/** Renders the same offscreen DocSheet but returns a PDF Blob instead of downloading (comms attachments). */
export async function renderDocSheetToPdfBlob(
  business: Business | null,
  data: Omit<PrintableDocData, 'businessName' | 'gstin'>
): Promise<Blob> {
  const full: PrintableDocData = {
    ...data,
    businessName: business?.legal_name || business?.name || 'Business',
    gstin: business?.gstin ?? null,
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;';
  document.body.appendChild(host);
  try {
    const root = createRoot(host);
    root.render(<DocSheet data={full} business={business} />);
    await new Promise((r) => setTimeout(r, 250));
    const blob = await captureElementToPdfBlob(host.firstElementChild as HTMLElement ?? host);
    root.unmount();
    return blob;
  } finally {
    host.remove();
  }
}
