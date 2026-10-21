import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ArrowLeft, Printer, Pencil, CheckCircle2, PackageOpen, Lock, Download, MessageCircle } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { captureElementToPdf } from '@/lib/pdfCapture';
import {
  UniversalDocumentTemplate,
  mapPurchaseOrderToUniversalData,
  printElementInIframe,
} from '@/components/documents/UniversalDocumentTemplate';
import { openWhatsAppShare } from '@/lib/whatsapp';

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  confirmed: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  received: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  fulfilled: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  converted: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  cancelled: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
};

const LOCKED: Record<string, boolean> = { received: true, fulfilled: true, converted: true, cancelled: true };

/**
 * PBS-146: dedicated full-width purchase-order detail page (replaces the
 * inline preview overlay). Mirrors the quotation detail layout: complete
 * action header + status controls + centred UniversalDocumentTemplate.
 */
export function PurchaseOrderViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['purchase-order', activeBusiness?.id, id],
    queryFn: async () => {
      if (!activeBusiness || !id) return null;
      const { data: order, error: oErr } = await supabase
        .from('purchase_orders')
        .select('*, supplier:suppliers(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .single();
      if (oErr) throw oErr;
      const { data: items, error: iErr } = await supabase
        .from('purchase_order_items')
        .select('*')
        .eq('purchase_order_id', id)
        .order('created_at');
      if (iErr) throw iErr;
      return { order: order as any, items: (items || []) as any[] };
    },
    enabled: !!activeBusiness && !!id,
  });

  const order = data?.order;
  const items = data?.items || [];

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!activeBusiness || !id) throw new Error('Order not loaded');
      const { error: uErr } = await supabase
        .from('purchase_orders')
        .update({ status })
        .eq('id', id)
        .eq('business_id', activeBusiness.id);
      if (uErr) throw uErr;
      return status;
    },
    onSuccess: (status: string) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-order', activeBusiness?.id, id] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders', activeBusiness?.id] });
      toast(`Purchase order marked ${status}`, 'success');
      setConfirmCancel(false);
    },
    onError: (err: any) => toast(err.message || 'Update failed', 'error'),
  });

  const handleDownloadPdf = async () => {
    if (!order) return;
    setPrinting(true);
    try {
      const el = document.getElementById('purchase-order-print-area');
      if (el) await captureElementToPdf(el, `${order.order_number}.pdf`);
    } catch (e: any) {
      toast(e.message || 'PDF export failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleWhatsApp = () => {
    if (!order) return;
    openWhatsAppShare({
      partyName: order.supplier?.name || '',
      docNumber: order.order_number,
      dateDDMMYYYY: formatDate(order.order_date),
      amountInr: formatCurrency(order.grand_total, activeBusiness?.currency_symbol || '₹'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: order.supplier?.phone,
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

  if (error || !order) {
    return (
      <div className="p-8 text-center">
        <p className="text-error-600 mb-4">Purchase order not found.</p>
        <Button onClick={() => navigate('/app/purchase-orders')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Purchase Orders
        </Button>
      </div>
    );
  }

  const isLocked = LOCKED[order.status];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title={`Purchase Order ${order.order_number}`}
        subtitle={`${formatDate(order.order_date)}${order.expected_delivery_date ? ` • Expected ${formatDate(order.expected_delivery_date)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/purchase-orders')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {!isLocked && (
              <Button variant="secondary" onClick={() => navigate(`/app/purchase-orders/${order.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" onClick={() => printElementInIframe('purchase-order-print-area', order.order_number)}>
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
              <span className={`badge text-sm px-3 py-1 ${statusStyles[order.status] || statusStyles.draft}`}>{order.status}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isLocked && order.status === 'draft' && (
              <Button onClick={() => statusMutation.mutate('confirmed')} loading={statusMutation.isPending}>
                <CheckCircle2 className="h-4 w-4" /> Confirm
              </Button>
            )}
            {!isLocked && order.status === 'confirmed' && (
              <>
                <Button onClick={() => statusMutation.mutate('received')} loading={statusMutation.isPending}>
                  <PackageOpen className="h-4 w-4" /> Receive
                </Button>
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>Cancel</Button>
              </>
            )}
            {isLocked && (
              <span className="inline-flex items-center gap-1.5 text-sm text-secondary-400">
                <Lock className="h-4 w-4" /> Locked Document
              </span>
            )}
          </div>
        </div>

        <div id="purchase-order-print-area">
          <UniversalDocumentTemplate
            data={mapPurchaseOrderToUniversalData(activeBusiness, order, items)}
            className="shadow-sm border border-secondary-200/80"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => statusMutation.mutate('cancelled')}
        title="Cancel purchase order?"
        message="The purchase order will be marked cancelled and become immutable."
        confirmText="Cancel Order"
        loading={statusMutation.isPending}
      />
    </div>
  );
}
