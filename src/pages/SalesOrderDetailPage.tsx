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
  Check,
  X,
  Lock,
  MessageCircle,
  Mail,
  Download,
  Truck,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { captureElementToPdf, captureElementToPdfBlob } from '@/lib/pdfCapture';
import {
  UniversalDocumentTemplate,
  printElementInIframe,
} from '@/components/documents/UniversalDocumentTemplate';
import { mapSalesOrderToUniversalData } from '@/lib/documentMappers';
import { mergeBusinessExtras } from '@/lib/businessExtras';
import { openWhatsAppShare } from '@/lib/whatsapp';
import { SendDialog } from '@/components/comms/SendDialog';
import type { SalesOrder, SalesOrderItem } from '@/types/db';

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  confirmed: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  fulfilled: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  converted: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  cancelled: 'bg-secondary-100 text-secondary-400 dark:bg-secondary-800 dark:text-secondary-500 line-through',
};

const LOCKED: Record<string, boolean> = { fulfilled: true, converted: true, cancelled: true };
const CAN_CONVERT: Record<string, boolean> = { confirmed: true, fulfilled: true };

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertDate, setConvertDate] = useState(new Date().toISOString().slice(0, 10));
  const [convertDue, setConvertDue] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-order', activeBusiness?.id, id],
    queryFn: async () => {
      if (!activeBusiness || !id) return null;

      let orderData: (SalesOrder & { customer: any }) | null = null;
      let itemsData: SalesOrderItem[] = [];

      const { data: orderWithItems, error: oWithItemsErr } = await supabase
        .from('sales_orders')
        .select('*, items:sales_order_items(*), customer:customer_id(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .maybeSingle();

      if (!oWithItemsErr && orderWithItems && Array.isArray((orderWithItems as any).items) && (orderWithItems as any).items.length > 0) {
        orderData = orderWithItems as SalesOrder & { customer: any };
        itemsData = (orderWithItems as any).items as SalesOrderItem[];
      } else {
        const { data: order, error: oErr } = await supabase
          .from('sales_orders')
          .select('*, customer:customer_id(*)')
          .eq('id', id)
          .eq('business_id', activeBusiness.id)
          .single();
        if (oErr) throw oErr;
        orderData = order as SalesOrder & { customer: any };

        const { data: items, error: iErr } = await supabase
          .from('sales_order_items')
          .select('*')
          .eq('sales_order_id', id)
          .order('created_at');
        if (iErr) throw iErr;
        itemsData = (items || []) as SalesOrderItem[];
      }

      if (orderData && !orderData.customer && (orderData as any).customer_id) {
        const { data: cData } = await supabase
          .from('customers')
          .select('*')
          .eq('id', (orderData as any).customer_id)
          .maybeSingle();
        if (cData) {
          orderData = { ...orderData, customer: cData };
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

      return {
        order: orderData,
        items: itemsData,
        business: bizData || activeBusiness,
      };
    },
    enabled: !!activeBusiness && !!id,
  });

  const order = data?.order;
  const items = data?.items || [];
  const effectiveBusiness = data?.business || activeBusiness;

  useEffect(() => {
    if (effectiveBusiness) {
      console.log('[SalesOrderViewPage] business logo_url:', effectiveBusiness?.logo_url);
    }
  }, [effectiveBusiness]);

  // Deep-link auto-print support for list rows: ?action=print, ?print=1, or ?autoprint=true
  useEffect(() => {
    if (order && (searchParams.get('print') === '1' || searchParams.get('action') === 'print' || searchParams.get('autoprint') === 'true')) {
      const t = setTimeout(() => {
        printElementInIframe('invoice-printable-area', `Sales Order ${order.order_number}`);
        setSearchParams({}, { replace: true });
      }, 350);
      return () => clearTimeout(t);
    }
  }, [order, searchParams, setSearchParams]);

  const invalidateAll = () => {
    ['sales-orders', 'sales-invoices', 'dashboard-stats'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
    );
  };

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!activeBusiness || !id) return;
      const { error: updErr } = await supabase
        .from('sales_orders')
        .update({ status })
        .eq('id', id)
        .eq('business_id', activeBusiness.id);
      if (updErr) throw updErr;
      return status;
    },
    onSuccess: (status) => {
      invalidateAll();
      toast(
        status === 'confirmed'
          ? 'Sales order confirmed'
          : status === 'fulfilled'
            ? 'Sales order fulfilled'
            : 'Sales order cancelled',
        'success'
      );
      setConfirmCancel(false);
    },
    onError: (err: any) => toast(err.message || 'Update failed', 'error'),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !id) throw new Error('Nothing to convert');
      const attempt = async (idKey: string) =>
        supabase.rpc('convert_sales_order_to_invoice', {
          p_business_id: activeBusiness!.id,
          [idKey]: id,
          p_invoice_date: convertDate,
          p_due_date: convertDue || null,
        });
      let res = await attempt('p_sales_order_id');
      if (res.error && /could not find function|candidate function/i.test(res.error.message)) {
        res = await attempt('p_order_id');
      }
      if (res.error) throw res.error;
      return res.data as { new_doc_id?: string; new_doc_number?: string } | null;
    },
    onSuccess: (d) => {
      invalidateAll();
      setConvertOpen(false);
      toast(`Converted to ${d?.new_doc_number || 'invoice'}`, 'success');
      if (d?.new_doc_id) navigate(`/app/sales-invoices/${d.new_doc_id}`);
      else navigate('/app/sales-invoices');
    },
    onError: (err: any) => toast(err.message || 'Conversion failed', 'error'),
  });

  const handleDownloadPdf = async () => {
    if (!activeBusiness || !order) return;
    setPrinting(true);
    try {
      const el = document.getElementById('invoice-printable-area');
      if (!el) throw new Error('Document not ready');
      await captureElementToPdf(el, `${order.order_number}.pdf`);
    } catch (e: any) {
      toast(e.message || 'PDF export failed', 'error');
    } finally {
      setPrinting(false);
    }
  };

  const handleWhatsApp = () => {
    if (!order) return;
    openWhatsAppShare({
      partyName: order.customer?.company_name || order.customer?.name || '',
      docNumber: order.order_number,
      dateDDMMYYYY: formatDate(order.order_date),
      amountInr: formatCurrency(order.grand_total, activeBusiness?.currency_symbol || '₹'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: order.customer?.phone,
    });
  };

  const handleEWayBill = () => {
    if (!order) return;
    if (order.converted_doc_id) {
      navigate(`/app/sales-invoices/${order.converted_doc_id}`);
      return;
    }
    toast('E-way bills are raised from the linked tax invoice — convert this order first', 'info');
    navigate('/app/eway-bill');
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
        <p className="text-error-600 mb-4">Sales order not found.</p>
        <Button onClick={() => navigate('/app/sales-orders')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to Sales Orders
        </Button>
      </div>
    );
  }

  const isLocked = LOCKED[order.status];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <PageHeader
        title={`Sales Order ${order.order_number}`}
        subtitle={`Created on ${formatDate(order.order_date)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/sales-orders')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {!isLocked && (
              <Button variant="secondary" onClick={() => navigate(`/app/sales-orders/${order.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            )}
            <Button variant="secondary" onClick={() => printElementInIframe('invoice-printable-area', `Sales Order ${order.order_number}`)}>
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
              <span className={`badge text-sm px-3 py-1 ${statusStyles[order.status]}`}>{order.status}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {order.status === 'draft' && (
              <Button onClick={() => statusMutation.mutate('confirmed')} loading={statusMutation.isPending}>
                <Check className="h-4 w-4" /> Confirm
              </Button>
            )}
            {order.status === 'confirmed' && (
              <>
                <Button onClick={() => statusMutation.mutate('fulfilled')} loading={statusMutation.isPending}>
                  <Check className="h-4 w-4" /> Mark Fulfilled
                </Button>
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
              </>
            )}
            {CAN_CONVERT[order.status] && (
              <Button onClick={() => setConvertOpen(true)}>Convert to Invoice</Button>
            )}
            <Button variant="secondary" onClick={handleEWayBill}>
              <Truck className="h-4 w-4" /> e-Way Bill
            </Button>
            {isLocked && (
              <span className="inline-flex items-center gap-1.5 text-sm text-secondary-400">
                <Lock className="h-4 w-4" /> Locked Document
              </span>
            )}
          </div>
        </div>

        <div id="invoice-printable-area">
          <UniversalDocumentTemplate
            data={mapSalesOrderToUniversalData(
              mergeBusinessExtras(effectiveBusiness, effectiveBusiness?.id || '') || effectiveBusiness,
              {
                ...order,
                customer: order.customer,
                expected_delivery_date: order.expected_date ?? (order as any).expected_delivery_date,
              },
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
        title="Cancel sales order?"
        message="The sales order will be marked cancelled and become immutable."
        confirmText="Cancel Order"
        loading={statusMutation.isPending}
      />

      <Modal open={convertOpen} onClose={() => setConvertOpen(false)} title="Convert to Tax Invoice" size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-4">
          Converting sales order <span className="font-semibold">{order.order_number}</span>
          {order.customer?.name ? ` for ${order.customer.name}` : ''}. Items, taxes and totals carry over.
        </p>
        <div className="space-y-4">
          <FormField label="Invoice Date" required>
            <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
          </FormField>
          <FormField label="Due Date (optional)">
            <Input type="date" value={convertDue} onChange={(e) => setConvertDue(e.target.value)} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setConvertOpen(false)}>Cancel</Button>
          <Button onClick={() => convertMutation.mutate()} loading={convertMutation.isPending} disabled={!convertDate}>Convert</Button>
        </div>
      </Modal>

      <div className="relative z-50">
        <SendDialog
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          contextLabel={`Sales Order ${order.order_number}`}
          docType="sales_order"
          docId={order.id}
          docNumber={order.order_number}
          templateKey="sales_order_sent"
          templateVariables={{
            customer_name: order.customer?.name || '',
            order_number: order.order_number,
            business_name: activeBusiness?.name || '',
            amount: formatCurrency(Number(order.grand_total || 0), activeBusiness?.currency_symbol),
            expected_date: order.expected_date ? formatDate(order.expected_date) : '—',
          }}
          defaultSubject={`Sales Order ${order.order_number} from ${activeBusiness?.name || 'us'}`}
          defaultMessage={`Dear ${order.customer?.name || 'customer'}, please find attached sales order ${order.order_number} totalling ${formatCurrency(Number(order.grand_total || 0), activeBusiness?.currency_symbol)}.`}
          recipients={[
            {
              label: order.customer?.name || 'Customer on record',
              email: order.customer?.email,
              phone: order.customer?.phone,
            },
          ]}
          attachments={[
            {
              id: 'sales-order-pdf',
              label: 'Sales Order PDF',
              filename: `${order.order_number}.pdf`,
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
