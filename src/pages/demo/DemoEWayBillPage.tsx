import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EWayBillModal, type EWayInvoiceRef } from '@/components/eway/EWayBillModal';
import { printElementInIframe } from '@/components/documents';
import { captureElementToPdf } from '@/lib/pdfCapture';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { usePagedList } from '@/hooks/usePagedList';
import {
  Truck, Plus, Printer, Eye, Trash2, FileDown, X,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  downloadNicJson,
  listEWayBills,
  deleteEWayBill,
  type EWayBill,
} from '@/lib/ewayBill';
import { listDemoDocs, type DemoDocRecord } from '@/lib/demoStore';

const PREVIEW_ID = 'demo-eway-preview-area';

function demoInvoiceRefs(docs: DemoDocRecord[]): EWayInvoiceRef[] {
  return docs.map((d) => ({
    id: d.id,
    invoice_number: d.number,
    invoice_date: String(d.header.invoice_date || new Date().toISOString()),
    grand_total: Number(d.header.grand_total || 0),
    customer: d.party as EWayInvoiceRef['customer'],
  }));
}

export function DemoEWayBillPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const businessId = activeBusiness?.id || '';

  const [refresh, setRefresh] = useState(0);
  const list = usePagedList();
  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState('');

  const [generateFor, setGenerateFor] = useState<EWayInvoiceRef | null>(null);
  const [pickedInvoiceId, setPickedInvoiceId] = useState('');
  const [previewBill, setPreviewBill] = useState<EWayBill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EWayBill | null>(null);
  const [busy, setBusy] = useState(false);

  const bills = useMemo(
    () => (businessId ? listEWayBills(businessId).filter((b) => b.demo) : []),
    [businessId, refresh]
  );

  const demoInvoices = useQuery({
    queryKey: ['demo-docs', businessId, 'sales_invoice'],
    queryFn: () => listDemoDocs(businessId, 'sales_invoice'),
    enabled: !!businessId,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bills.filter((b) => {
      if (docType && b.docType !== docType) return false;
      if (!q) return true;
      return (
        b.ewayBillNo.includes(q) ||
        b.invoiceNumber.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.vehicleNo.toLowerCase().includes(q)
      );
    });
  }, [bills, search, docType]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);

  const pickRef = (): EWayInvoiceRef | null => {
    if (!demoInvoices.data?.length) return null;
    const refs = demoInvoiceRefs(demoInvoices.data);
    return refs.find((r) => r.id === pickedInvoiceId) || refs[0] || null;
  };

  const refreshAll = () => {
    setRefresh((r) => r + 1);
    queryClient.invalidateQueries({ queryKey: ['demo-docs', businessId] });
  };

  const printBill = async (download: boolean) => {
    const el = document.getElementById(PREVIEW_ID);
    if (!el) return;
    setBusy(true);
    try {
      if (download) {
        await captureElementToPdf(el, `Demo_EWayBill_${previewBill?.ewayBillNo}.pdf`);
        toast('Demo e-Way bill PDF saved — sandbox only', 'success');
      } else {
        printElementInIframe(el, `Demo e-Way Bill ${previewBill?.ewayBillNo}`);
      }
    } catch (err: unknown) {
      toast((err as Error)?.message || 'Export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!activeBusiness) return null;

  const rows = pageRows;

  return (
    <div>
      <PageHeader
        title="Demo e-Way Bills"
        subtitle="Proforma sandbox — generate and export demo e-Way bills; NIC payloads identical to real generation, zero effect on your GST filings"
        actions={
          <Button
            onClick={() => setGenerateFor(pickRef())}
            disabled={!demoInvoices.data?.length}
          >
            <Plus className="h-4 w-4" /> New Demo e-Way Bill
          </Button>
        }
      />

      {!demoInvoices.data?.length && (
        <div className="card p-4 mb-4 text-sm text-secondary-600 dark:text-secondary-300 border-l-4 border-amber-400">
          Create a <strong>Demo Sales Invoice</strong> first — demo e-Way bills generate against demo invoices.
        </div>
      )}

      <div className="card">
        <ListToolbar
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            list.setPage(1);
          }}
          placeholder="Search by bill number, invoice, customer or vehicle..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
          leftAddon={
            <select
              className="input h-9 py-0 leading-none text-xs cursor-pointer w-36 px-2.5 rounded-md"
              aria-label="e-Way bill document type filter"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              <option value="">All doc types</option>
              <option value="Tax Invoice">Tax Invoice</option>
              <option value="Bill of Supply">Bill of Supply</option>
              <option value="Delivery Challan">Delivery Challan</option>
            </select>
          }
        >
          <select
            className="input h-9 py-0 leading-none text-xs cursor-pointer px-2.5 rounded-md"
            aria-label="Demo invoice to generate bill for"
            value={pickedInvoiceId}
            onChange={(e) => setPickedInvoiceId(e.target.value)}
            disabled={!demoInvoices.data?.length}
          >
            <option value="">
              {demoInvoices.data?.length ? `Pick demo invoice (${(demoInvoices.data || []).length})` : 'No demo invoices yet'}
            </option>
            {(demoInvoices.data || []).map((d) => (
              <option key={d.id} value={d.id}>{d.number}</option>
            ))}
          </select>
          <Button className="h-9" onClick={() => setGenerateFor(pickRef())} disabled={!demoInvoices.data?.length}>
            <Plus className="h-4 w-4" /> Generate Demo Bill
          </Button>
        </ListToolbar>

        {bills.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No demo e-Way bills yet"
            description="Pick a demo sales invoice and generate a demo e-Way bill with Part-A / Part-B details. The NIC-schema JSON export works exactly like the real one — nothing registers with the NIC, obviously."
            action={
              demoInvoices.data?.length ? (
                <Button onClick={() => setGenerateFor(pickRef())}>
                  <Plus className="h-4 w-4" /> New Demo e-Way Bill
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary-50 dark:bg-secondary-800/60">
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Bill No</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Doc No</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Customer</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Vehicle</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Val (₹)</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-secondary-500">Valid Until</th>
                  <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-secondary-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-t border-secondary-100 dark:border-secondary-800 hover:bg-secondary-50/60 dark:hover:bg-secondary-800/40">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-secondary-900 dark:text-white">{b.ewayBillNo}</td>
                    <td className="px-3 py-2 text-xs text-secondary-600 dark:text-secondary-300">{b.docType} · {b.invoiceNumber}</td>
                    <td className="px-3 py-2 text-xs text-secondary-800 dark:text-secondary-200">{b.customerName}</td>
                    <td className="px-3 py-2 text-xs font-mono text-secondary-600 dark:text-secondary-300">{b.vehicleNo}</td>
                    <td className="px-3 py-2 text-right text-xs font-mono text-secondary-900 dark:text-white">{b.totalValue.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-xs text-secondary-600 dark:text-secondary-300">{formatDate(b.validUntil)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => setPreviewBill(b)}
                          className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                          title="Preview bill"
                          aria-label="Preview bill"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => downloadNicJson(b, activeBusiness?.gstin ?? null)}
                          className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                          title="Download NIC JSON"
                          aria-label="Download NIC JSON"
                        >
                          <FileDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(b)}
                          className="p-1.5 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                          title="Delete demo bill"
                          aria-label="Delete demo bill"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-4 pb-3 pt-1 flex justify-center">
            <ListPagination
              page={list.page}
              onPageChange={list.setPage}
              pageSize={list.pageSize}
              from={list.from}
              total={filtered.length}
            />
          </div>
        )}
      </div>

      {/* Generate modal (shared real component, demo-tagged output) */}
      {generateFor && (
        <EWayBillModal
          open
          onClose={() => setGenerateFor(null)}
          business={activeBusiness}
          invoice={generateFor}
          demoMode
          onCreated={() => refreshAll()}
        />
      )}

      {/* Preview / print block */}
      {previewBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewBill(null)} />
          <div className="relative bg-white dark:bg-secondary-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin">
            <div className="p-5 border-b border-secondary-200 dark:border-secondary-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-secondary-900 dark:text-white">Demo e-Way Bill {previewBill.ewayBillNo}</h2>
                <p className="text-sm text-secondary-500">Sandbox record — valid until {formatDate(previewBill.validUntil)}</p>
              </div>
              <button
                onClick={() => setPreviewBill(null)}
                className="p-1.5 rounded-lg text-secondary-400 hover:bg-secondary-100 dark:hover:bg-secondary-800"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-sm text-secondary-800 dark:text-secondary-200">
              <div id={PREVIEW_ID} className="bg-white text-slate-800 rounded-lg border border-slate-200 p-5 text-xs">
                <p className="text-center text-2xl font-black tracking-widest text-amber-600 mb-1">DEMO E-WAY BILL</p>
                <p className="text-center text-[10px] uppercase tracking-wider text-amber-500/80 mb-4">Not For Statutory Use — Sandbox</p>
                <div className="grid grid-cols-2 gap-2 font-mono">
                  <div><span className="font-sans font-semibold">Bill No:</span> {previewBill.ewayBillNo}</div>
                  <div><span className="font-sans font-semibold">Doc:</span> {previewBill.docType} · {previewBill.invoiceNumber}</div>
                  <div><span className="font-sans font-semibold">Date:</span> {formatDate(previewBill.docDate)}</div>
                  <div><span className="font-sans font-semibold">Customer:</span> {previewBill.customerName}</div>
                  <div><span className="font-sans font-semibold">Sub Type:</span> {previewBill.subType}</div>
                  <div><span className="font-sans font-semibold">Value:</span> {formatCurrency(previewBill.totalValue, '₹')}</div>
                  <div><span className="font-sans font-semibold">From:</span> {previewBill.fromAddress} ({previewBill.fromPincode})</div>
                  <div><span className="font-sans font-semibold">To:</span> {previewBill.toAddress} ({previewBill.toPincode})</div>
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono mt-3 pt-3 border-t border-slate-200">
                  <div><span className="font-sans font-semibold">Part-B Mode:</span> {previewBill.transportMode}</div>
                  <div><span className="font-sans font-semibold">Distance:</span> {previewBill.distanceKm} km</div>
                  <div><span className="font-sans font-semibold">Vehicle:</span> {previewBill.vehicleNo}</div>
                  <div><span className="font-sans font-semibold">Transporter:</span> {previewBill.transporterName || previewBill.transporterId || '—'}</div>
                  {previewBill.lrNo && <div><span className="font-sans font-semibold">LR No:</span> {previewBill.lrNo}</div>}
                  {previewBill.lrDate && <div><span className="font-sans font-semibold">LR Date:</span> {formatDate(previewBill.lrDate)}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void printBill(false)} loading={busy}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <Button onClick={() => void printBill(true)} loading={busy}>
                  <FileDown className="h-4 w-4" /> Save as PDF
                </Button>
                <Button variant="secondary" onClick={() => downloadNicJson(previewBill, activeBusiness?.gstin ?? null)}>
                  <FileDown className="h-4 w-4" /> NIC JSON
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && businessId) {
            deleteEWayBill(businessId, deleteTarget.id);
            refreshAll();
            toast('Demo e-Way bill deleted', 'success');
          }
          setDeleteTarget(null);
        }}
        title="Delete demo e-Way bill?"
        message={`Bill ${deleteTarget?.ewayBillNo || ''} will be removed from the sandbox. Your real GST filings were never affected.`}
        confirmText="Delete demo bill"
      />
    </div>
  );
}
