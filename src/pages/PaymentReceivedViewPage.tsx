import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  ArrowLeft,
  Pencil,
  Printer,
  Download,
  MessageCircle,
  Mail,
  CreditCard,
  Calendar,
  User,
  Hash,
} from 'lucide-react';
import { formatCurrency, formatDate, roundTo2 } from '@/lib/utils';
import { printPaymentReceipt, generateReceiptHtml, RECEIPT_STYLES, formatReceiptDateTime, type PaymentReceiptData } from '@/lib/receiptPrint';
import { resolveBusinessProfile } from '@/lib/documentMappers';
import { captureElementToPdf } from '@/lib/pdfCapture';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { SendDialog } from '@/components/comms/SendDialog';

export function PaymentReceivedViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const isPrintingRef = useRef(false);
  const businessProfile = activeBusiness ? resolveBusinessProfile(activeBusiness) : null;

  const handlePrint = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isPrintingRef.current || !payment) return;
    isPrintingRef.current = true;
    printPaymentReceipt(payment, businessProfile);
    setTimeout(() => {
      isPrintingRef.current = false;
    }, 1000);
  };

  const { data: payment, isLoading, isError, refetch } = useQuery({
    queryKey: ['payment-received', activeBusiness?.id, id],
    queryFn: async (): Promise<PaymentReceiptData | null> => {
      if (!activeBusiness || !id) return null;

      // 1. Fetch from primary payments table
      let { data: row, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .maybeSingle();

      // Defensive fallback to payments_received table if needed
      if (!row) {
        const alt = await supabase
          .from('payments_received')
          .select('*')
          .eq('id', id)
          .eq('business_id', activeBusiness.id)
          .maybeSingle();
        if (alt.data) row = alt.data;
      }

      if (error && !row) throw error;
      if (!row) return null;

      let custId = row.party_id || (row as any).customer_id;
      const invId = row.invoice_id;

      const [custRes, invRes] = await Promise.all([
        custId
          ? supabase.from('customers').select('*').eq('id', custId).maybeSingle()
          : Promise.resolve({ data: null }),
        invId
          ? supabase.from('sales_invoices').select('id, invoice_number, grand_total, balance_amount, customer_id').eq('id', invId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      let customerData = custRes.data;
      if (!customerData && invRes.data?.customer_id) {
        const altCust = await supabase
          .from('customers')
          .select('*')
          .eq('id', invRes.data.customer_id)
          .maybeSingle();
        if (altCust.data) customerData = altCust.data;
      }

      return {
        ...row,
        payment_number: row.payment_number || (row as any).receipt_number || 'RECEIPT',
        amount: Number(row.amount) || 0,
        allocated_amount: Number(row.allocated_amount) || 0,
        date: row.payment_date || row.date || (row as any).payment_date || row.created_at,
        payment_date: row.payment_date || row.date || null,
        time: row.time || (row as any).payment_time || null,
        created_at: row.created_at,
        customer: customerData || (row as any).customer || null,
        invoice: invRes.data || null,
      } as PaymentReceiptData;
    },
    enabled: !!activeBusiness && !!id,
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  const handleDownloadPdf = async () => {
    if (!payment) return;
    setDownloading(true);
    try {
      const el = document.getElementById('receipt-printable-area');
      if (!el) throw new Error('Receipt preview element not ready');
      await captureElementToPdf(el, `${payment.payment_number || 'payment-receipt'}.pdf`);
      toast('Receipt PDF downloaded successfully', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to download PDF', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleWhatsApp = () => {
    if (!payment) return;
    openWhatsAppShare({
      partyName: payment.customer?.company_name || payment.customer?.name || '',
      docNumber: payment.payment_number,
      dateDDMMYYYY: formatDate(payment.payment_date || payment.date),
      amountInr: formatCurrency(payment.amount, sym),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: payment.customer?.phone,
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
        <div className="h-10 w-48 bg-secondary-200 dark:bg-secondary-800 rounded animate-pulse" />
        <div className="h-32 bg-secondary-100 dark:bg-secondary-800/50 rounded-xl animate-pulse" />
        <div className="h-96 bg-secondary-100 dark:bg-secondary-800/30 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (isError || !payment) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center space-y-4">
        <ErrorState
          title="Payment receipt not found"
          message="The requested payment could not be loaded or may have been deleted."
          onRetry={() => { void refetch(); }}
        />
        <Button onClick={() => navigate('/app/payments-received')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Payments Received
        </Button>
      </div>
    );
  }

  const amount = Number(payment.amount) || 0;
  const allocated = Number(payment.allocated_amount) || 0;
  const unapplied = Math.max(0, roundTo2(amount - allocated));

  let statusLabel = 'Applied';
  let statusVariant: 'success' | 'warning' | 'neutral' = 'success';
  if (unapplied > 0 && allocated > 0) {
    statusLabel = 'Partially Applied';
    statusVariant = 'warning';
  } else if (allocated === 0) {
    statusLabel = 'Unallocated / Advance';
    statusVariant = 'neutral';
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* 1. Header Toolbar matching Sales Order view */}
      <PageHeader
        title={`Payment Receipt ${payment.payment_number}`}
        subtitle={`Recorded on ${formatDate(payment.payment_date || payment.date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/payments-received')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/app/payments-received/${payment.id}/edit`)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button variant="secondary" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="secondary" onClick={handleDownloadPdf} loading={downloading}>
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

      {/* 2. Status Header Card / Document Details Bar matching Sales Order view */}
      <div className="card p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-secondary-900 border border-secondary-200 dark:border-secondary-800 rounded-xl shadow-sm">
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-secondary-400">Payment Status</span>
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge variant={statusVariant} className="text-xs font-semibold px-2.5 py-0.5">
              {statusLabel}
            </Badge>
            {unapplied > 0 && (
              <span className="text-xs font-medium text-warning-700 dark:text-warning-300 bg-warning-50 dark:bg-warning-900/30 px-2 py-0.5 rounded border border-warning-200 dark:border-warning-800">
                Unallocated: <strong>{formatCurrency(unapplied, sym)}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
          <div>
            <span className="text-xs text-secondary-400 uppercase tracking-wider font-semibold block flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Date &amp; Time
            </span>
            <span className="text-sm font-semibold text-secondary-800 dark:text-secondary-100">
              {formatReceiptDateTime(payment.payment_date || payment.date, payment.created_at, payment.time)}
            </span>
          </div>

          <div>
            <span className="text-xs text-secondary-400 uppercase tracking-wider font-semibold block flex items-center gap-1">
              <CreditCard className="h-3 w-3" /> Mode
            </span>
            <span className="text-sm font-semibold uppercase text-secondary-800 dark:text-secondary-100">
              {payment.payment_method || 'CASH'}
            </span>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-xs text-secondary-400 uppercase tracking-wider font-semibold block">
              Amount Received
            </span>
            <span className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {formatCurrency(payment.amount, sym)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Center Canvas displaying standard receipt template */}
      <div className="card shadow-sm border border-secondary-200 dark:border-secondary-800 p-2 sm:p-6 bg-white overflow-x-auto rounded-xl">
        <div id="receipt-printable-area" className="w-full max-w-[800px] mx-auto bg-white text-slate-800">
          <style dangerouslySetInnerHTML={{ __html: RECEIPT_STYLES }} />
          <div dangerouslySetInnerHTML={{ __html: generateReceiptHtml(payment, businessProfile) }} />
        </div>
      </div>

      {/* 4. Send Receipt Dialog */}
      <SendDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        contextLabel={`Receipt ${payment.payment_number}`}
        docType="payment_receipt"
        docId={payment.id}
        docNumber={payment.payment_number}
        templateKey="payment_received"
        templateVariables={{
          customer_name: payment.customer?.name || '',
          invoice_number: payment.invoice?.invoice_number || '—',
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(Number(payment.amount || 0), sym),
        }}
        defaultSubject={`Payment received — thank you (${payment.payment_number})`}
        defaultMessage={`Dear ${payment.customer?.name || 'customer'}, we have received your payment of ${formatCurrency(Number(payment.amount || 0), sym)} (receipt ${payment.payment_number}). Thank you for your business.`}
        recipients={[
          {
            label: payment.customer?.name || 'Customer on record',
            email: payment.customer?.email,
            phone: payment.customer?.phone,
          },
        ]}
      />
    </div>
  );
}
