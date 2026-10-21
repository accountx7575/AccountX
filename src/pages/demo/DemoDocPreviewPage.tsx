import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { ArrowLeft, FileDown, Layers, Printer } from 'lucide-react';
import {
  mapQuotationToUniversalData,
  mapSalesInvoiceToUniversalData,
  mapSalesOrderToUniversalData,
  printElementInIframe,
  UniversalDocumentTemplate,
} from '@/components/documents';
import { captureElementToPdf } from '@/lib/pdfCapture';
import {
  getDemoDoc,
  setDemoDocHeaderMode,
  downloadDemoCsv,
  sanitizeDemoFilename,
  type DemoKind,
} from '@/lib/demoStore';

const PREVIEW_ID = 'demo-document-preview-area';

const KIND: Record<DemoKind, { title: string; home: string; scope: string; csvTitle: string }> = {
  quotation: { title: 'Demo Quotation', home: '/app/demo/quotations', scope: 'quotation', csvTitle: 'QUOTATION' },
  sales_invoice: { title: 'Demo Invoice', home: '/app/demo/invoices', scope: 'sales_invoice', csvTitle: 'TAX_INVOICE' },
  sales_order: { title: 'Demo Sales Order', home: '/app/demo/orders', scope: 'sales_order', csvTitle: 'SALES_ORDER' },
};

export function DemoDocPreviewPage({ kind }: { kind: DemoKind }) {
  const cfg = KIND[kind];
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [busy, setBusy] = useState(false);

  const docQuery = useQuery({
    queryKey: ['demo-docs', activeBusiness?.id, kind, id],
    queryFn: () => getDemoDoc(activeBusiness?.id || '', id || ''),
    enabled: !!activeBusiness && !!id,
  });

  const doc = docQuery.data;

  const [headerMode, setHeaderMode] = useState<'estimate' | 'demo' | 'clean' | null>(null);

  const data = useMemo(() => {
    if (!doc || !activeBusiness) return null;
    const withParty = { ...doc.header, customer: doc.party };
    if (kind === 'quotation') return mapQuotationToUniversalData(activeBusiness, withParty, doc.items);
    if (kind === 'sales_order')
      return mapSalesOrderToUniversalData(activeBusiness, { ...withParty, expected_delivery_date: doc.header.expected_date }, doc.items);
    return mapSalesInvoiceToUniversalData(activeBusiness, withParty, doc.items);
  }, [doc, activeBusiness, kind]);

  const activeMode = headerMode || doc?.headerMode || 'demo';

  const partyName = String((doc?.party as Record<string, string> | null)?.company_name || (doc?.party as Record<string, string> | null)?.name || '');

  const fileNameFor = (ext: string) =>
    `Demo_${sanitizeDemoFilename(cfg.csvTitle)}_${sanitizeDemoFilename(doc?.number || '')}_${sanitizeDemoFilename(partyName).replace(/\s+/g, '-')}.${ext}`;

  const handlePrint = () => {
    if (!data) return;
    printElementInIframe(document.getElementById(PREVIEW_ID) || PREVIEW_ID, `${cfg.title} ${doc?.number || ''}`);
  };

  const handlePdf = async () => {
    const el = document.getElementById(PREVIEW_ID);
    if (!el) return;
    setBusy(true);
    try {
      await captureElementToPdf(el, fileNameFor('pdf'));
      toast('Demo PDF saved — sandbox only', 'success');
    } catch (err: unknown) {
      toast((err as Error)?.message || 'PDF export failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExcel = () => {
    if (!doc || !activeBusiness) return;
    downloadDemoCsv(kind, cfg.csvTitle, activeBusiness.name || '', doc);
    toast('Demo sheet downloaded (CSV opens in Excel)', 'success');
  };

  const handleModeChange = (mode: 'estimate' | 'demo' | 'clean') => {
    if (!doc || !activeBusiness) return;
    setDemoDocHeaderMode(activeBusiness.id, doc.id, mode);
    setHeaderMode(mode);
    queryClient.invalidateQueries({ queryKey: ['demo-docs', activeBusiness.id] });
    toast(
      mode === 'clean'
        ? 'Clean layout — identical to real documents for client dispatch'
        : mode === 'estimate'
          ? 'ESTIMATE / PROFORMA INVOICE header applied'
          : 'DEMO header applied',
      'success'
    );
  };

  if (!activeBusiness) return null;

  if (!docQuery.data && docQuery.isError) return (
    <div><PageHeader title={cfg.title} actions={<Button variant="secondary" onClick={() => navigate(cfg.home)}><ArrowLeft className="h-4 w-4" /> Back</Button>} /><div className="card p-10 text-center text-sm text-error-600">Demo document not found</div></div>
  );

  if (!docQuery.data) return (
    <div><PageHeader title={cfg.title} actions={<Button variant="secondary" onClick={() => navigate(cfg.home)}><ArrowLeft className="h-4 w-4" /> Back</Button>} /><div className="card p-10 text-center text-sm text-secondary-500">Loading demo document…</div></div>
  );

  return (
    <div>
      <PageHeader
        title={`${cfg.title} ${doc?.number || ''}`}
        subtitle="Proforma sandbox — nothing here touches your ledger, stock or GST series"
        actions={
          <Button variant="secondary" onClick={() => navigate(cfg.home)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="demo-header-mode" className="text-xs font-bold uppercase tracking-wide text-secondary-500">
              Demo header
            </label>
            <select
              id="demo-header-mode"
              className="input h-9 py-0 leading-none text-xs cursor-pointer w-auto min-w-[200px] px-2.5 rounded-md"
              value={activeMode}
              onChange={(e) => handleModeChange(e.target.value as 'estimate' | 'demo' | 'clean')}
            >
              <option value="estimate">ESTIMATE / PROFORMA INVOICE</option>
              <option value="demo">DEMO QUOTATION</option>
              <option value="clean">Clean — standard layout</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button className="h-9" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button className="h-9" onClick={() => void handlePdf()} loading={busy}>
              <FileDown className="h-4 w-4" /> Save as PDF
            </Button>
            <Button className="h-9" onClick={handleExcel}>
              <Layers className="h-4 w-4" /> Excel
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {data && (
          <UniversalDocumentTemplate data={{ ...data, demoHeader: activeMode }} id={PREVIEW_ID} />
        )}
      </div>
    </div>
  );
}

export function DemoQuotationPreviewPage() {
  return <DemoDocPreviewPage kind="quotation" />;
}

export function DemoInvoicePreviewPage() {
  return <DemoDocPreviewPage kind="sales_invoice" />;
}

export function DemoOrderPreviewPage() {
  return <DemoDocPreviewPage kind="sales_order" />;
}
