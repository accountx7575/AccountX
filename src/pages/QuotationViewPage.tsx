import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Input, FormField } from '@/components/ui/Input';
import {
  ArrowLeft,
  Printer,
  Pencil,
  Send,
  Check,
  X,
  Lock,
  MessageCircle,
  Mail,
  Download,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { convertQuotationToInvoice } from '@/lib/quotationConvert';
import { captureElementToPdf, captureElementToPdfBlob } from '@/lib/pdfCapture';
import {
  UniversalDocumentTemplate,
  printElementInIframe,
} from '@/components/documents/UniversalDocumentTemplate';
import { mapQuotationToUniversalData } from '@/lib/documentMappers';
import { mergeBusinessExtras } from '@/lib/businessExtras';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { SendDialog } from '@/components/comms/SendDialog';
import type { Quotation, QuotationItem } from '@/types/db';

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  sent: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  accepted: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  rejected: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
  converted: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  cancelled: 'bg-secondary-100 text-secondary-400 dark:bg-secondary-800 dark:text-secondary-500 line-through',
};

const LOCKED: Record<string, boolean> = { accepted: true, rejected: true, converted: true, cancelled: true };
const CAN_CONVERT: Record<string, boolean> = { sent: true, accepted: true };

export function QuotationViewPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<'invoice' | 'sales_order' | null>(null);
  const [convertDate, setConvertDate] = useState(new Date().toISOString().slice(0, 10));
  const [convertDue, setConvertDue] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['quotation', activeBusiness?.id, id],
    queryFn: async () => {
      if (!activeBusiness || !id) return null;

      let quoteData: (Quotation & { customer: any }) | null = null;
      let itemsData: QuotationItem[] = [];

      const { data: quoteWithItems, error: qWithItemsErr } = await supabase
        .from('quotations')
        .select('*, items:quotation_items(*), customer:customer_id(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .maybeSingle();

      if (!qWithItemsErr && quoteWithItems && Array.isArray((quoteWithItems as any).items) && (quoteWithItems as any).items.length > 0) {
        quoteData = quoteWithItems as Quotation & { customer: any };
        itemsData = (quoteWithItems as any).items as QuotationItem[];
      } else {
        const { data: quote, error: qErr } = await supabase
          .from('quotations')
          .select('*, customer:customer_id(*)')
          .eq('id', id)
          .eq('business_id', activeBusiness.id)
          .single();
        if (qErr) throw qErr;
        quoteData = quote as Quotation & { customer: any };

        const { data: items, error: iErr } = await supabase
          .from('quotation_items')
          .select('*')
          .eq('quotation_id', id)
          .order('created_at');
        if (iErr) throw iErr;
        itemsData = (items || []) as QuotationItem[];
      }

      if (quoteData && !quoteData.customer && (quoteData as any).customer_id) {
        const { data: cData } = await supabase
          .from('customers')
          .select('*')
          .eq('id', (quoteData as any).customer_id)
          .maybeSingle();
        if (cData) {
          quoteData = { ...quoteData, customer: cData };
        }
      }

      let bizData: any = null;
      if (activeBusiness?.id) {
        const { data: b } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', activeBusiness.id)
          .maybeSingle();
        bizData = b;
      }

      return { quote: quoteData, items: itemsData, business: bizData || activeBusiness };
    },
    enabled: !!activeBusiness && !!id,
  });

  const quote = data?.quote;
  const items = data?.items || [];

  // Deep-link auto-print support for list rows: ?action=print, ?print=1, or ?autoprint=true
  useEffect(() => {
    if (quote && (searchParams.get('print') === '1' || searchParams.get('action') === 'print' || searchParams.get('autoprint') === 'true')) {
      const t = setTimeout(() => {
        printElementInIframe('invoice-printable-area', `Quotation ${quote.quotation_number}`);
        setSearchParams({}, { replace: true });
      }, 350);
      return () => clearTimeout(t);
    }
  }, [quote, searchParams, setSearchParams]);

  const invalidateAll = () => {
    ['quotations', 'quotations-data', 'quotation', 'dashboard-stats'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k] })
    );
  };

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!activeBusiness || !id) return;
      const { error } = await supabase.from('quotations').update({ status }).eq('id', id).eq('business_id', activeBusiness.id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      invalidateAll();
      toast(`Quotation marked ${status}`, 'success');
      setConfirmCancel(false);
    },
    onError: (err: any) => toast(err.message || 'Update failed', 'error'),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !id) return;
      return convertQuotationToInvoice({
        businessId: activeBusiness.id,
        quotationId: id,
        invoiceDate: convertDate,
        dueDate: convertDue || null,
      });
    },
    onSuccess: (d: any) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      setConvertTarget(null);
      toast(`Converted to ${d?.new_doc_number || 'invoice'}`, 'success');
      navigate('/app/sales-invoices');
    },
    onError: (err: any) => toast(err.message || 'Conversion failed', 'error'),
  });

  const convertSoMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !id) return;
      const { data: sData, error } = await supabase.rpc('convert_quotation_to_sales_order', {
        p_quotation_id: id,
        p_order_date: convertDate,
      });
      if (error) throw error;
      return sData;
    },
    onSuccess: (d: any) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['sales-orders', activeBusiness?.id] });
      setConvertTarget(null);
      toast(`Converted to ${d?.new_doc_number || 'sales order'}`, 'success');
      navigate('/app/sales-orders');
    },
    onError: (err: any) => toast(err.message || 'Conversion failed', 'error'),
  });

  const handleDownloadPdf = async () => {
    if (!activeBusiness || !quote) return;
    setPrinting(true);
    try {
      const el = document.getElementById('invoice-printable-area');
      if (!el) throw new Error('Document not ready');
      await captureElementToPdf(el, `${quote.quotation_number}.pdf`);
    } catch (e: any) {
      toast(e.message || 'PDF export failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleWhatsApp = () => {
    if (!quote) return;
    openWhatsAppShare({
      partyName: quote.customer?.name || '',
      docNumber: quote.quotation_number,
      dateDDMMYYYY: formatDate(quote.quote_date),
      amountInr: formatCurrency(quote.grand_total, activeBusiness?.currency_symbol || '₹'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: quote.customer?.phone,
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <div className="h-10 w-48 bg-secondary-200 dark:bg-secondary-800 rounded animate-pulse" />
        <div className="h-64 bg-secondary-100 dark:bg-secondary-800/50 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="p-8 text-center">
        <p className="text-error-600 mb-4">Quotation not found.</p>
        <Button onClick={() => navigate('/app/quotations')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Quotations
        </Button>
      </div>
    );
  }

  const sym = activeBusiness?.currency_symbol || '₹';
  const isLocked = LOCKED[quote.status];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title={`Quotation ${quote.quotation_number}`}
        subtitle={`Created on ${formatDate(quote.quote_date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/quotations')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {!isLocked && (
              <Button variant="secondary" onClick={() => navigate(`/app/quotations/${quote.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" onClick={() => printElementInIframe('invoice-printable-area', `Quotation ${quote.quotation_number}`)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="secondary" onClick={handleDownloadPdf} loading={printing}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
            <Button variant="secondary" onClick={handleWhatsApp}>
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => setSendOpen(true)}>
              <Mail className="h-4 w-4" /> Email
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <div className="card p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-secondary-400">Document Status</span>
            <div className="mt-1">
              <span className={`badge text-sm px-3 py-1 ${statusStyles[quote.status]}`}>{quote.status}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {quote.status === 'draft' && (
              <Button onClick={() => statusMutation.mutate('sent')} loading={statusMutation.isPending}>
                <Send className="h-4 w-4" /> Mark Sent
              </Button>
            )}
            {quote.status === 'sent' && (
              <>
                <Button onClick={() => statusMutation.mutate('accepted')} loading={statusMutation.isPending}>
                  <Check className="h-4 w-4" /> Accept
                </Button>
                <Button variant="secondary" onClick={() => statusMutation.mutate('rejected')} loading={statusMutation.isPending}>
                  <X className="h-4 w-4" /> Reject
                </Button>
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                  Cancel
                </Button>
              </>
            )}
            {CAN_CONVERT[quote.status] && (
              <>
                <Button onClick={() => setConvertTarget('invoice')}>Convert to Invoice</Button>
                <Button variant="secondary" onClick={() => setConvertTarget('sales_order')}>Convert to SO</Button>
              </>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1.5 text-sm text-secondary-400">
                <Lock className="h-4 w-4" /> Locked Document
              </span>
            )}
          </div>
        </div>

        <div id="invoice-printable-area">
          <UniversalDocumentTemplate
            data={mapQuotationToUniversalData(
              mergeBusinessExtras(activeBusiness, activeBusiness?.id || '') || activeBusiness,
              quote,
              items
            )}
            className="shadow-sm border border-secondary-200/80"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => statusMutation.mutate('cancelled')}
        title="Cancel quotation?"
        message="The quotation will be marked cancelled and become immutable."
        confirmText="Cancel Quote"
        loading={statusMutation.isPending}
      />

      <Modal open={!!convertTarget} onClose={() => setConvertTarget(null)} title={convertTarget === 'invoice' ? 'Convert to Tax Invoice' : 'Convert to Sales Order'} size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-4">
          Converting quotation <span className="font-semibold">{quote.quotation_number}</span>.
        </p>
        <div className="space-y-4">
          <FormField label={convertTarget === 'invoice' ? 'Invoice Date' : 'Order Date'} required>
            <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
          </FormField>
          {convertTarget === 'invoice' && (
            <FormField label="Due Date (optional)">
              <Input type="date" value={convertDue} onChange={(e) => setConvertDue(e.target.value)} />
            </FormField>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setConvertTarget(null)}>Cancel</Button>
          <Button
            onClick={() => (convertTarget === 'invoice' ? convertMutation.mutate() : convertSoMutation.mutate())}
            loading={convertMutation.isPending || convertSoMutation.isPending}
            disabled={!convertDate}
          >
            Convert
          </Button>
        </div>
      </Modal>

      <div className="relative z-50">
        <SendDialog
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          contextLabel={`Quotation ${quote.quotation_number}`}
          docType="quotation"
          docId={quote.id}
          docNumber={quote.quotation_number}
          templateKey="quotation_sent"
          templateVariables={{
            customer_name: quote.customer?.name || '',
            quotation_number: quote.quotation_number,
            business_name: activeBusiness?.name || '',
            amount: formatCurrency(Number(quote.grand_total || 0), activeBusiness?.currency_symbol),
            expiry_date: quote.expiry_date ? formatDate(quote.expiry_date) : '—',
          }}
          defaultSubject={`Quotation ${quote.quotation_number} from ${activeBusiness?.name || 'us'}`}
          defaultMessage={`Dear ${quote.customer?.name || 'customer'}, please find attached quotation ${quote.quotation_number} totalling ${formatCurrency(Number(quote.grand_total || 0), activeBusiness?.currency_symbol)}.`}
          recipients={[
            {
              label: quote.customer?.name || 'Customer on record',
              email: quote.customer?.email,
              phone: quote.customer?.phone,
            },
          ]}
          attachments={[
            {
              id: 'quotation-pdf',
              label: 'Quotation PDF',
              filename: `${quote.quotation_number}.pdf`,
              build: async () => {
                if (!activeBusiness) throw new Error('Business unavailable');
                const el = document.getElementById('invoice-printable-area');
                if (!el) throw new Error('Document not ready');
                return captureElementToPdfBlob(el);
              },
            },
          ]}
        />
      </div>
    </div>
  );
}