import React from "react";

/* ------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------- */

export interface CompanyInfo {
  name: string;
  tagline?: string;
  address: string;
  mobile: string;
  email: string;
  gstin: string;
  panNumber?: string;
  logoUrl?: string;
}

export interface PartyInfo {
  name: string;
  address: string;
  placeOfSupply?: string;
  mobile: string;
}

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
}

export interface QuotationItem {
  sno: number;
  title: string;
  description: string[];
  qty: number;
  unit: string;
  rate: number;
  taxRate: number; // percentage, e.g. 18
  amount: number; // qty * rate, pre-tax line amount shown in AMOUNT column
}

export interface HsnRow {
  hsnSac: string;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalTax: number;
}

export interface QuotationData {
  seller: CompanyInfo;
  billTo: PartyInfo;
  shipTo: PartyInfo;
  quotationNo: string;
  quotationDate: string;
  expiryDate: string;
  items: QuotationItem[];
  hsnRows: HsnRow[];
  totalAmountWords: string;
  bank: BankDetails;
  terms: string[];
  jurisdictionNote?: string;
}

/* ------------------------------------------------------------------------
 * Mock data (swap for real data via props)
 * ---------------------------------------------------------------------- */

const mockData: QuotationData = {
  seller: {
    name: "Avadh Boring Company",
    tagline: "Borewell, Pumps & Solar Energy Solutions",
    address: "An-25, Lauta Bagh, Azad Nagar, Barabanki, Uttar Pradesh, 225001",
    mobile: "+91 9450942418",
    email: "abc.solar7575@gmail.com",
    gstin: "09AABPQ3096M1Z5",
  },
  billTo: {
    name: "Mohd Shoeb",
    address:
      "Daxin Tola Banki, Banki, Barabanki, Nawabganj (Barabanki), Up-225001, Barabanki, Uttar Pradesh, 225001",
    placeOfSupply: "Uttar Pradesh",
    mobile: "7985032002",
  },
  shipTo: {
    name: "Mohd Shoeb",
    address:
      "Daxin Tola Banki, Banki, Barabanki, Nawabganj (Barabanki), Up-225001, Barabanki, Uttar Pradesh, 225001",
    mobile: "7985032002",
  },
  quotationNo: "ABC/QO/26-27/21",
  quotationDate: "29/06/2026",
  expiryDate: "29/07/2026",
  items: [
    {
      sno: 1,
      title: "3kW Microtake 3480 Microtake Topcon Panel",
      description: [
        "With Appolo JIE installation",
        "Havells ACDB/DCDB 600V with SPD",
        "3 set copper bonded earthing, 1 set LA",
        "DC/AC wire Polycab/Microtake/Havells",
        "Net metering",
        "PVC pipe 16kg",
      ],
      qty: 1,
      unit: "PCS",
      rate: 193220.34,
      taxRate: 18,
      amount: 228000,
    },
  ],
  hsnRows: [
    {
      hsnSac: "85414011",
      taxableValue: 193220.34,
      cgstRate: 9,
      cgstAmount: 17389.83,
      sgstRate: 9,
      sgstAmount: 17389.83,
      totalTax: 34779.66,
    },
  ],
  totalAmountWords: "Two Lakh Twenty Eight Thousand Rupees",
  bank: {
    bankName: "Canara Bank",
    accountName: "Avadh Boring Company",
    accountNumber: "120034396413",
    ifsc: "CNRB0018631",
    branch: "Barabanki",
  },
  terms: [
    "Payment 100% advance.",
    'All payments to be drawn in favour of "Avadh Boring Company", payable at Barabanki.',
    "This quotation is valid for 15 days, subject to availability with our principals.",
    "All subject to Barabanki jurisdiction (E.&O.E.).",
  ],
};

/* ------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

const formatINR = (value: number): string =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const totals = (items: QuotationItem[], hsnRows: HsnRow[]) => {
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const tax = hsnRows.reduce((s, r) => s + r.totalTax, 0);
  const grandTotal = items.reduce((s, i) => s + i.amount, 0);
  return { qty, tax, grandTotal };
};

/* ------------------------------------------------------------------------
 * Component
 * ---------------------------------------------------------------------- */

interface DocPrintProps {
  data?: QuotationData;
}

const DocPrint: React.FC<DocPrintProps> = ({ data = mockData }) => {
  const { seller, billTo, shipTo, items, hsnRows, bank, terms } = data;
  const { qty, tax, grandTotal } = totals(items, hsnRows);

  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* Print-only page rules */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 10mm;
          }
          html, body {
            background: #ffffff !important;
          }
          .no-print {
            display: none !important;
          }
          .print-sheet {
            box-shadow: none !important;
            border: none !important;
            width: 100% !important;
            margin: 0 !important;
          }
          .avoid-break {
            break-inside: avoid;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
          }
          thead {
            display: table-header-group;
          }
        }
      `}</style>

      {/* Floating action bar (screen only) */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="font-medium text-slate-700">Quotation</span>
          <span>·</span>
          <span>{data.quotationNo}</span>
        </div>
        <button
          onClick={handlePrint}
          className="rounded-md bg-[#0F2942] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16385A] focus:outline-none focus:ring-2 focus:ring-[#0F2942] focus:ring-offset-2"
        >
          Print / Download PDF
        </button>
      </div>

      {/* Printable sheet */}
      <div className="print-sheet mx-auto my-8 max-w-3xl bg-white p-8 shadow-lg print:my-0 print:p-0 sm:p-10">
        {/* ---------------- Header ---------------- */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-[#0F2942] pb-5">
          <div className="flex gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-[#0F2942] text-lg font-semibold text-white">
              {seller.name
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                {seller.name}
              </h1>
              {seller.tagline && (
                <p className="text-sm text-[#B4790F]">{seller.tagline}</p>
              )}
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                {seller.address}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                <span>{seller.mobile}</span>
                <span>{seller.email}</span>
              </div>
              <p className="mt-1 text-xs font-medium text-slate-600">
                GSTIN: <span className="font-mono">{seller.gstin}</span>
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span className="inline-block rounded bg-[#0F2942] px-3 py-1 text-xs font-semibold tracking-wide text-white">
              QUOTATION
            </span>
            <dl className="mt-3 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Quotation No.</dt>
                <dd className="font-mono font-medium text-slate-800">
                  {data.quotationNo}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Date</dt>
                <dd className="font-medium text-slate-800">{data.quotationDate}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">Valid until</dt>
                <dd className="font-medium text-slate-800">{data.expiryDate}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* ---------------- Bill To / Ship To ---------------- */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="avoid-break rounded-md border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-400">Bill to</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{billTo.name}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {billTo.address}
            </p>
            {billTo.placeOfSupply && (
              <p className="mt-1 text-xs text-slate-500">
                Place of supply: {billTo.placeOfSupply}
              </p>
            )}
            <p className="text-xs text-slate-500">Mobile: {billTo.mobile}</p>
          </div>
          <div className="avoid-break rounded-md border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-400">Ship to</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{shipTo.name}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {shipTo.address}
            </p>
            <p className="text-xs text-slate-500">Mobile: {shipTo.mobile}</p>
          </div>
        </div>

        {/* ---------------- Items table ---------------- */}
        <div className="mt-6 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#0F2942] text-left text-xs font-medium uppercase tracking-wide text-white">
                <th className="w-10 px-3 py-2 text-center">#</th>
                <th className="px-3 py-2">Item / Description</th>
                <th className="w-14 px-3 py-2 text-center">Qty</th>
                <th className="w-24 px-3 py-2 text-right">Rate (₹)</th>
                <th className="w-16 px-3 py-2 text-right">Tax</th>
                <th className="w-28 px-3 py-2 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr
                  key={item.sno}
                  className={`avoid-break align-top ${
                    idx % 2 === 1 ? "bg-slate-50" : "bg-white"
                  }`}
                >
                  <td className="px-3 py-3 text-center text-slate-500">{item.sno}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-900">{item.title}</p>
                    {item.description.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                        {item.description.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-3 text-center text-slate-700">
                    {item.qty} {item.unit}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700">
                    {formatINR(item.rate)}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-500">
                    {item.taxRate}%
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900">
                    {formatINR(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#0F2942] bg-slate-50 text-sm font-semibold text-slate-900">
                <td className="px-3 py-2.5" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-2.5 text-center">{qty}</td>
                <td className="px-3 py-2.5"></td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {formatINR(tax)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {formatINR(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ---------------- HSN/SAC tax summary ---------------- */}
        <div className="avoid-break mt-6 overflow-hidden rounded-md border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-left uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">HSN/SAC</th>
                <th className="px-3 py-2 text-right">Taxable value</th>
                <th className="px-3 py-2 text-right">CGST rate</th>
                <th className="px-3 py-2 text-right">CGST amt</th>
                <th className="px-3 py-2 text-right">SGST rate</th>
                <th className="px-3 py-2 text-right">SGST amt</th>
                <th className="px-3 py-2 text-right">Total tax</th>
              </tr>
            </thead>
            <tbody>
              {hsnRows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-slate-700">{row.hsnSac || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {formatINR(row.taxableValue)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {row.cgstRate}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {formatINR(row.cgstAmount)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {row.sgstRate}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {formatINR(row.sgstAmount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                    {formatINR(row.totalTax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---------------- Amount in words ---------------- */}
        <div className="avoid-break mt-4 rounded-md border border-[#0F2942]/20 bg-[#0F2942]/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Total amount in words
          </p>
          <p className="mt-0.5 text-sm font-medium text-slate-800">
            {data.totalAmountWords} Only
          </p>
        </div>

        {/* ---------------- Footer: Bank / Terms / Signatory ---------------- */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="avoid-break rounded-md border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-400">Bank details</p>
            <dl className="mt-2 space-y-1 text-xs text-slate-600">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Bank</dt>
                <dd className="text-right font-medium">{bank.bankName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Account name</dt>
                <dd className="text-right font-medium">{bank.accountName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Account no.</dt>
                <dd className="text-right font-mono font-medium">
                  {bank.accountNumber}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">IFSC</dt>
                <dd className="text-right font-mono font-medium">{bank.ifsc}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Branch</dt>
                <dd className="text-right font-medium">{bank.branch}</dd>
              </div>
            </dl>
          </div>

          <div className="avoid-break rounded-md border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-400">
              Terms &amp; conditions
            </p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">
              {terms.map((t, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-[#B4790F]">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="avoid-break flex flex-col items-center justify-between rounded-md border border-slate-200 p-4 text-center">
            <p className="text-xs font-semibold text-slate-400">
              Authorised signatory for
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">{seller.name}</p>
            <div className="mt-8 w-full border-t border-dashed border-slate-300 pt-2 text-xs text-slate-400">
              Signature &amp; stamp
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[10px] text-slate-400">
          This is a computer-generated quotation and does not require a physical
          signature to be valid unless otherwise specified.
        </p>
      </div>
    </div>
  );
};

export default DocPrint;
export async function renderDocSheetToPdfBlob(business: any, doc: PrintableDocData): Promise<Blob> {
  const container = buildHtmlTemplate(business, doc);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
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

// Yeh function missing tha jiski wajah se build fail hui:
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