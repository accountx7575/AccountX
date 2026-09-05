import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { renderDocSheetToPdf, renderDocSheetToPdfBlob } from '@/lib/docPrint';
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
      const { data: quote, error: qErr } = await supabase
        .from('quotations')
        .select('*, customer:customers(*)')
        .eq('id', id)
        .eq('business_id', activeBusiness.id)
        .single();
      if (qErr) throw qErr;

      const { data: items, error: iErr } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', id)
        .order('created_at');
      if (iErr) throw iErr;

      return { quote: quote as Quotation & { customer: any }, items: (items || []) as QuotationItem[] };
    },
    enabled: !!activeBusiness && !!id,
  });

  const quote = data?.quote;
  const items = data?.items || [];

  const invalidateAll = () => {
    ['quotations', 'quotation', 'dashboard-stats'].forEach((k) =>
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
      const { data, error } = await supabase.rpc('convert_quotation_to_invoice', {
        p_business_id: activeBusiness.id,
        p_quotation_id: id,
        p_invoice_date: convertDate,
        p_due_date: convertDue || null,
      });
      if (error) throw error;
      return data;
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
      const { data, error } = await supabase.rpc('convert_quotation_to_sales_order', {
        p_quotation_id: id,
        p_order_date: convertDate,
      });
      if (error) throw error;
      return data;
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

  const handlePrint = async () => {
    if (!activeBusiness || !quote) return;
    setPrinting(true);
    try {
      await renderDocSheetToPdf(activeBusiness, {
        docTitle: 'QUOTATION',
        docNumber: quote.quotation_number,
        dateLabel: 'Quote Date',
        dateValue: formatDate(quote.quote_date),
        expiryLabel: 'Valid Until',
        expiryValue: quote.expiry_date,
        partyLabel: 'Customer',
        partyName: quote.customer?.name || '—',
        status: quote.status,
        items,
        subtotal: Number(quote.subtotal),
        taxableAmount: Number(quote.taxable_amount),
        cgst: Number(quote.cgst_amount),
        sgst: Number(quote.sgst_amount),
        igst: Number(quote.igst_amount),
        roundOff: Number(quote.round_off) || 0,
        grandTotal: Number(quote.grand_total),
        notes: quote.notes,
        terms: quote.terms,
      });
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
            <Button variant="secondary" onClick={handlePrint} loading={printing}>
              <Printer className="h-4 w-4" /> Download PDF
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

      {/* Main Document Preview Card */}
      <div className="card p-6 sm:p-8 space-y-6 border border-secondary-200 dark:border-secondary-800 shadow-sm">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-secondary-200 dark:border-secondary-800">
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

        {/* Customer & Quote Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-4 rounded-xl bg-secondary-50/80 dark:bg-secondary-900/50">
          <div>
            <p className="text-xs font-medium text-secondary-400">Customer</p>
            <p className="text-base font-semibold text-secondary-900 dark:text-secondary-100 mt-0.5">{quote.customer?.name || '—'}</p>
            {quote.customer?.email && <p className="text-xs text-secondary-500">{quote.customer.email}</p>}
            {quote.customer?.phone && <p className="text-xs text-secondary-500">{quote.customer.phone}</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-400">Quote Date</p>
            <p className="text-base font-semibold text-secondary-900 dark:text-secondary-100 mt-0.5">{formatDate(quote.quote_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-400">Valid Until</p>
            <p className="text-base font-semibold text-secondary-900 dark:text-secondary-100 mt-0.5">{quote.expiry_date ? formatDate(quote.expiry_date) : '—'}</p>
          </div>
        </div>

        {/* Items Table */}
        <div className="border border-secondary-200 dark:border-secondary-800 rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary-100/70 dark:bg-secondary-800/60 text-secondary-600 dark:text-secondary-300 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3">Item & Description</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Tax %</th>
                <th className="px-4 py-3 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100 dark:divide-secondary-800/50">
              {items.map((it) => (
                <tr key={it.id} className="table-row-hover">
                  <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{it.product_name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300">{it.quantity} {it.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300">{formatCurrency(it.rate, sym)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300">{it.tax_rate}%</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-secondary-900 dark:text-secondary-100">{formatCurrency(it.total_amount, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Notes & Totals */}
        <div className="flex flex-col sm:flex-row justify-between gap-6 pt-2">
          <div className="flex-1 text-sm space-y-3">
            {quote.terms && (
              <div>
                <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wider">Terms & Conditions</p>
                <p className="text-secondary-600 dark:text-secondary-300 mt-1 whitespace-pre-wrap">{quote.terms}</p>
              </div>
            )}
          </div>
          <div className="w-full sm:w-80 space-y-2 text-sm bg-secondary-50/50 dark:bg-secondary-900/30 p-4 rounded-xl border border-secondary-200/60 dark:border-secondary-800/60">
            <div className="flex justify-between text-secondary-500">
              <span>Taxable Amount</span>
              <span className="figure font-medium">{formatCurrency(quote.taxable_amount, sym)}</span>
            </div>
            {Number(quote.cgst_amount) > 0 && (
              <div className="flex justify-between text-secondary-500">
                <span>CGST</span>
                <span className="figure font-medium">{formatCurrency(quote.cgst_amount, sym)}</span>
              </div>
            )}
            {Number(quote.sgst_amount) > 0 && (
              <div className="flex justify-between text-secondary-500">
                <span>SGST</span>
                <span className="figure font-medium">{formatCurrency(quote.sgst_amount, sym)}</span>
              </div>
            )}
            {Number(quote.igst_amount) > 0 && (
              <div className="flex justify-between text-secondary-500">
                <span>IGST</span>
                <span className="figure font-medium">{formatCurrency(quote.igst_amount, sym)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-secondary-200 dark:border-secondary-700 pt-2 text-primary-600 dark:text-primary-400">
              <span>Grand Total</span>
              <span className="figure">{formatCurrency(quote.grand_total, sym)}</span>
            </div>
          </div>
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
              return renderDocSheetToPdfBlob(activeBusiness, {
                docTitle: 'QUOTATION',
                docNumber: quote.quotation_number,
                dateLabel: 'Quote Date',
                dateValue: formatDate(quote.quote_date),
                expiryLabel: 'Valid Until',
                expiryValue: quote.expiry_date,
                partyLabel: 'Customer',
                partyName: quote.customer?.name || '—',
                status: quote.status,
                items,
                subtotal: Number(quote.subtotal),
                taxableAmount: Number(quote.taxable_amount),
                cgst: Number(quote.cgst_amount),
                sgst: Number(quote.sgst_amount),
                igst: Number(quote.igst_amount),
                roundOff: Number(quote.round_off) || 0,
                grandTotal: Number(quote.grand_total),
                notes: quote.notes,
                terms: quote.terms,
              });
            },
          },
        ]}
      />
    </div>
  );
}