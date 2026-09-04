import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { InvoiceSheet, type InvoiceWithCustomer } from '@/components/invoice/InvoiceSheet';
import { SendDialog } from '@/components/comms/SendDialog';
import { ArrowLeft, Printer, FileDown, Ban, FileSpreadsheet, Share2, Send, History } from 'lucide-react';
import { formatDate, formatCurrency } from '@/lib/utils';
import { printInvoice, exportPdfFromElement, exportInvoiceExcel } from '@/lib/invoiceExport';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { captureElementToPdfBlob } from '@/lib/pdfCapture';
import type { SalesInvoiceItem } from '@/types/db';

export function SalesInvoiceViewPage() {
  const { id: invoiceId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-invoice', invoiceId],
    queryFn: async () => {
      if (!invoiceId) throw new Error('No invoice selected');
      const invRes = await supabase
        .from('sales_invoices')
        .select('*, customer:customers(*)')
        .eq('id', invoiceId)
        .single();
      if (invRes.error) throw invRes.error;
      const itemsRes = await supabase
        .from('sales_invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('created_at');
      if (itemsRes.error) throw itemsRes.error;
      return {
        invoice: invRes.data as InvoiceWithCustomer,
        items: (itemsRes.data || []) as SalesInvoiceItem[],
      };
    },
    enabled: !!invoiceId,
  });

  const exportPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportPdfFromElement(
        document.getElementById('invoice-print-area'),
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

  // Deep-link support for list rows: /view?print=1 opens the doc and prints immediately.
  useEffect(() => {
    if (data && searchParams.get('print') === '1') {
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
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" onClick={() => navigate('/app/sales-invoices')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
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

      {/* Printable GST tax-invoice document (shared InvoiceSheet component). */}
      <div id="invoice-print-area">
        <InvoiceSheet business={activeBusiness} invoice={invoice} items={data.items} />
      </div>

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
              const el = document.getElementById('invoice-print-area');
              if (!el) throw new Error('Invoice document is not rendered yet.');
              return captureElementToPdfBlob(el);
            },
          },
        ]}
      />
    </div>
  );
}
