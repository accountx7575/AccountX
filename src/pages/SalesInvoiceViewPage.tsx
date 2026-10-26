import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { UniversalDocumentTemplate } from '@/components/documents/UniversalDocumentTemplate';
import { mapSalesInvoiceToUniversalData } from '@/lib/documentMappers';
import { mergeBusinessExtras } from '@/lib/businessExtras';
import { SendDialog } from '@/components/comms/SendDialog';
import { ArrowLeft, Printer, FileDown, Ban, FileSpreadsheet, Share2, Send, History, Truck, Pencil } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { printInvoice, exportPdfFromElement, exportInvoiceExcel, type InvoiceWithCustomer } from '@/lib/invoiceExport';
import { EWayBillModal } from '@/components/eway/EWayBillModal';
import { findEWayBillByInvoiceId } from '@/lib/ewayBill';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import type { SalesInvoiceItem } from '@/types/db';

export function SalesInvoiceViewPage() {
  const { id: invoiceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [ewayOpen, setEwayOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-invoice', invoiceId],
    queryFn: async () => {
      if (!invoiceId) throw new Error('No invoice selected');

      let invoiceData: InvoiceWithCustomer | null = null;
      let itemsData: SalesInvoiceItem[] = [];

      const { data: invWithItems, error: invWithItemsErr } = await supabase
        .from('sales_invoices')
        .select('*, items:sales_invoice_items(*), customer:customer_id(*)')
        .eq('id', invoiceId)
        .maybeSingle();

      if (!invWithItemsErr && invWithItems && Array.isArray((invWithItems as any).items) && (invWithItems as any).items.length > 0) {
        invoiceData = invWithItems as InvoiceWithCustomer;
        itemsData = (invWithItems as any).items as SalesInvoiceItem[];
      } else {
        const invRes = await supabase
          .from('sales_invoices')
          .select('*, customer:customer_id(*)')
          .eq('id', invoiceId)
          .single();
        if (invRes.error) throw invRes.error;
        invoiceData = invRes.data as InvoiceWithCustomer;

        const itemsRes = await supabase
          .from('sales_invoice_items')
          .select('*')
          .eq('invoice_id', invoiceId)
          .order('created_at');
        if (itemsRes.error) throw itemsRes.error;
        itemsData = (itemsRes.data || []) as SalesInvoiceItem[];
      }

      if (invoiceData && !invoiceData.customer && (invoiceData as any).customer_id) {
        const { data: cData } = await supabase
          .from('customers')
          .select('*')
          .eq('id', (invoiceData as any).customer_id)
          .maybeSingle();
        if (cData) {
          invoiceData = { ...invoiceData, customer: cData };
        }
      }

      let bizData: any = null;
      const bId = (invoiceData as any)?.business_id || activeBusiness?.id;
      if (bId) {
        const { data: b } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', bId)
          .maybeSingle();
        bizData = b;
      }

      return {
        invoice: invoiceData,
        items: itemsData,
        business: bizData || activeBusiness,
      };
    },
    enabled: !!invoiceId,
  });

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportPdfFromElement(
        document.getElementById('invoice-printable-area'),
        data.invoice.invoice_number,
        data.invoice.customer?.company_name || data.invoice.customer?.name
      );
      toast('PDF exported', 'success');
    } catch (err: any) {
      toast(err?.message || 'Failed to export PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Deep-link support for list rows: /view?action=print or ?print=1 opens the doc and prints immediately.
  useEffect(() => {
    if (data && (searchParams.get('print') === '1' || searchParams.get('action') === 'print' || searchParams.get('autoprint') === 'true')) {
      const t = setTimeout(() => {
        printInvoice();
        setSearchParams({}, { replace: true });
      }, 300);
      return () => clearTimeout(t);
    }
  }, [data, searchParams, setSearchParams]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
        <div className="card p-8 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState title="Failed to load invoice" onRetry={() => refetch()} />;
  }

  const { invoice } = data;

  // Directive-10: the invoice document is the ONE UniversalDocumentTemplate.
  // Mapping reuses the canonical UDT adapter (what the retired thin invoice
  // wrapper used), so the printed/preview output is unchanged.
  const liveBusiness = data?.business || activeBusiness;
  const printBusiness = mergeBusinessExtras(liveBusiness, liveBusiness?.id || '');
  const ewayBill = liveBusiness && invoiceId
    ? findEWayBillByInvoiceId(liveBusiness.id, invoiceId)
    : null;
  const docData = mapSalesInvoiceToUniversalData(printBusiness, invoice, data.items);
  if (ewayBill?.ewayBillNo || ewayBill?.vehicleNo) {
    const ewayInfo = [
      ewayBill.ewayBillNo ? `e-Way Bill No: ${ewayBill.ewayBillNo}` : '',
      ewayBill.vehicleNo ? `Vehicle No: ${ewayBill.vehicleNo}` : '',
    ].filter(Boolean).join(' • ');
    docData.taxNote = docData.taxNote ? `${docData.taxNote} | ${ewayInfo}` : ewayInfo;
  }

  const shareOnWhatsApp = () => {
    const opened = openWhatsAppShare({
      partyName: invoice.customer?.name || '',
      docNumber: invoice.invoice_number,
      dateDDMMYYYY: formatDate(invoice.invoice_date),
      amountInr: formatCurrency(invoice.grand_total, activeBusiness?.currency_symbol || '\u20B9'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: invoice.customer?.phone,
    });
    if (!opened) toast('Could not open WhatsApp — allow popups and try again', 'error');
  };

  const statusVariantMap: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
    draft: 'neutral', issued: 'info', partially_paid: 'warning',
    paid: 'success', cancelled: 'error', void: 'error',
  };

  return (
    <div>
      <PageHeader
        title={`Invoice ${invoice.invoice_number}`}
        subtitle={`${formatDate(invoice.invoice_date)}${invoice.due_date ? ` • Due ${formatDate(invoice.due_date)}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="secondary" onClick={() => navigate('/app/sales-invoices')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {invoice.status !== 'cancelled' && (
              <Button variant="secondary" onClick={() => navigate(`/app/sales-invoices/${invoice.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" onClick={exportPdf} loading={exporting}>
              <FileDown className="h-4 w-4" /> Save as PDF
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  exportInvoiceExcel(activeBusiness, invoice, data.items);
                  toast('Excel (.csv) exported', 'success');
                } catch (err: any) {
                  toast(err?.message || 'Failed to export Excel', 'error');
                }
              }}
              title="Export line items to Excel (.csv)"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </Button>
            <Button
              variant="secondary"
              onClick={shareOnWhatsApp}
              title="Share this invoice with the customer over WhatsApp"
            >
              <Share2 className="h-4 w-4" /> Share on WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => setSendOpen(true)} title="Send by email or WhatsApp with a PDF attached">
              <Send className="h-4 w-4" /> Send
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/app/communications?ref=${encodeURIComponent(invoice.invoice_number)}`)} title="Delivery history for this invoice">
              <History className="h-4 w-4" /> History
            </Button>
            {Number(invoice.grand_total) > 50000 && invoice.status !== 'cancelled' && (
              <Button variant="secondary" onClick={() => setEwayOpen(true)} title="Generate e-Way Bill for this invoice">
                <Truck className="h-4 w-4" /> Generate e-Way Bill
              </Button>
            )}
            <Button onClick={printInvoice}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {invoice.status === 'cancelled' && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-error-50 dark:bg-error-900/20 text-error-700 dark:text-error-300 text-sm print:hidden">
          <Ban className="h-4 w-4" /> This invoice is CANCELLED — shown for records only.
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 print:hidden">
        <Badge variant={statusVariantMap[invoice.status] || 'neutral'}>{invoice.status.replace('_', ' ')}</Badge>
        <Badge variant={invoice.payment_status === 'paid' ? 'success' : invoice.payment_status === 'partial' ? 'warning' : 'neutral'}>
          {invoice.payment_status}
        </Badge>
      </div>

      {/* Printable GST tax-invoice document — UniversalDocumentTemplate only (Directive-10). */}
      <UniversalDocumentTemplate data={docData} id="invoice-printable-area" />

      <EWayBillModal
        open={ewayOpen}
        onClose={() => setEwayOpen(false)}
        business={activeBusiness}
        invoice={invoice}
      />

      <SendDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        contextLabel={`Invoice ${invoice.invoice_number}`}
        docType="sales_invoice"
        docId={invoice.id}
        docNumber={invoice.invoice_number}
        templateKey="invoice_sent"
        templateVariables={{
          customer_name: invoice.customer?.name || '',
          invoice_number: invoice.invoice_number,
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(invoice.grand_total, activeBusiness?.currency_symbol),
          due_date: invoice.due_date ? formatDate(invoice.due_date) : '—',
        }}
        defaultSubject={`Invoice ${invoice.invoice_number} from ${activeBusiness?.name || 'us'}`}
        defaultMessage={`Dear ${invoice.customer?.name || 'customer'}, please find attached invoice ${invoice.invoice_number} for ${formatCurrency(invoice.grand_total, activeBusiness?.currency_symbol)}.`}
        recipients={[
          {
            label: invoice.customer?.company_name || invoice.customer?.name || 'Customer on record',
            email: invoice.customer?.email,
            phone: invoice.customer?.phone,
          },
        ]}
        attachments={[
          {
            id: 'invoice-pdf',
            label: 'Invoice PDF (as printed)',
            filename: `${invoice.invoice_number}.pdf`,
            build: async () => {
              const el = document.getElementById('invoice-printable-area');
              if (!el) throw new Error('Invoice document is not rendered yet.');
              return captureElementToPdfBlob(el);
            },
          },
        ]}
      />
    </div>
  );
}
