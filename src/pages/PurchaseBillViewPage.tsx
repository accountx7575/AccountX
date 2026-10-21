import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ArrowLeft, Printer, Pencil, Lock, Download, MessageCircle, CheckCircle2, Ban, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { captureElementToPdf } from '@/lib/pdfCapture';
import {
  UniversalDocumentTemplate,
  mapPurchaseBillToUniversalData,
  printElementInIframe,
} from '@/components/documents/UniversalDocumentTemplate';
import { openWhatsAppShare } from '@/lib/whatsapp';

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  confirmed: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  partially_paid: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  paid: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  cancelled: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
};

const LOCKED: Record<string, boolean> = { paid: true, cancelled: true };

/**
 * PBS-146: dedicated full-width purchase-bill detail page. Mirrors the
 * quotation detail layout: complete action header + status controls +
 * centred UniversalDocumentTemplate. Status writes reuse the SAME RPCs the
 * purchase-bills list uses (issue_document / cancel_draft / cancel_purchase_bill)
 * so there is a single write path per transition.
 */
export function PurchaseBillViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchase-bill', activeBusiness?.id, id],
    queryFn: async () => {
      if (!activeBusiness || !id) return null;
      const { data: bill, error: bErr } = await supabase
        .from('purchase_bills')
        .select('*, supplier:suppliers(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .single();
      if (bErr) throw bErr;
      const { data: items, error: iErr } = await supabase
        .from('purchase_bill_items')
        .select('*')
        .eq('bill_id', id)
        .order('created_at');
      if (iErr) throw iErr;
      return { bill: bill as any, items: (items || []) as any[] };
    },
    enabled: !!activeBusiness && !!id,
  });

  const bill = data?.bill;
  const items = data?.items || [];

  const invalidate = () => {
    ['purchase-bill', 'purchase-bills', 'dashboard-stats', 'accounts', 'journal-entries', 'trial-balance', 'products']
      .forEach((k) => queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] }));
    queryClient.invalidateQueries({ queryKey: ['purchase-bill', activeBusiness?.id, id] });
  };

  const issueMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !id) throw new Error('Bill not loaded');
      const { error: iErr } = await supabase.rpc('issue_document', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'purchase_bill',
        p_doc_id: id,
      });
      if (iErr) throw iErr;
    },
    onSuccess: () => {
      invalidate();
      toast('Bill confirmed — journal and stock posted', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to confirm bill', 'error'),
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !id) throw new Error('Bill not loaded');
      const { error: dErr } = await supabase.rpc('cancel_draft', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'purchase_bill',
        p_doc_id: id,
      });
      if (dErr) throw dErr;
    },
    onSuccess: () => {
      invalidate();
      setConfirmDiscard(false);
      toast('Draft discarded', 'success');
      navigate('/app/purchase-bills');
    },
    onError: (err: any) => toast(err.message || 'Failed to discard draft', 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Bill not loaded');
      const { error: cErr } = await supabase.rpc('cancel_purchase_bill', { p_bill_id: id });
      if (cErr) throw cErr;
    },
    onSuccess: () => {
      invalidate();
      setConfirmCancel(false);
      toast('Bill cancelled and accounting reversed', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to cancel bill', 'error'),
  });

  const handleDownloadPdf = async () => {
    if (!bill) return;
    setPrinting(true);
    try {
      const el = document.getElementById('purchase-bill-print-area');
      if (el) await captureElementToPdf(el, `${bill.bill_number}.pdf`);
    } catch (e: any) {
      toast(e.message || 'PDF export failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleWhatsApp = () => {
    if (!bill) return;
    openWhatsAppShare({
      partyName: bill.supplier?.name || '',
      docNumber: bill.bill_number,
      dateDDMMYYYY: formatDate(bill.bill_date),
      amountInr: formatCurrency(bill.grand_total, activeBusiness?.currency_symbol || '₹'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: bill.supplier?.phone,
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

  if (error || !bill) {
    return (
      <div className="p-8 text-center">
        <p className="text-error-600 mb-4">Purchase bill not found.</p>
        <Button onClick={() => navigate('/app/purchase-bills')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Bills
        </Button>
      </div>
    );
  }

  const isLocked = LOCKED[bill.status];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title={`Purchase Bill ${bill.bill_number}`}
        subtitle={`${formatDate(bill.bill_date)}${bill.due_date ? ` • Due ${formatDate(bill.due_date)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/purchase-bills')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {bill.status === 'draft' && (
              <Button variant="secondary" onClick={() => navigate(`/app/purchase-bills/${bill.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" onClick={() => printElementInIframe('purchase-bill-print-area', bill.bill_number)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="secondary" onClick={handleDownloadPdf} loading={printing}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
            <Button variant="secondary" onClick={handleWhatsApp}>
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <div className="card p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-secondary-400">Document Status</span>
            <div className="mt-1">
              <span className={`badge text-sm px-3 py-1 ${statusStyles[bill.status] || statusStyles.draft}`}>{bill.status.replace('_', ' ')}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {bill.status === 'draft' && (
              <>
                <Button onClick={() => issueMutation.mutate()} loading={issueMutation.isPending}>
                  <CheckCircle2 className="h-4 w-4" /> Confirm Bill
                </Button>
                <Button variant="secondary" onClick={() => setConfirmDiscard(true)}>
                  <Trash2 className="h-4 w-4" /> Discard draft
                </Button>
              </>
            )}
            {['confirmed', 'partially_paid'].includes(bill.status) && (
              <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                <Ban className="h-4 w-4" /> Cancel bill
              </Button>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1.5 text-sm text-secondary-400">
                <Lock className="h-4 w-4" /> Locked Document
              </span>
            )}
          </div>
        </div>

        <div id="purchase-bill-print-area">
          <UniversalDocumentTemplate
            data={mapPurchaseBillToUniversalData(activeBusiness, bill, items)}
            className="shadow-sm border border-secondary-200/80"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancel purchase bill?"
        message="The bill will be cancelled and the accounting entries reversed."
        confirmText="Cancel Bill"
        loading={cancelMutation.isPending}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => discardMutation.mutate()}
        title="Discard this draft?"
        message="The draft bill will be discarded. This cannot be undone."
        confirmText="Discard draft"
        loading={discardMutation.isPending}
      />
    </div>
  );
}
