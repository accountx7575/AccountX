import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FileText, Plus, Search, Ban, Eye, CheckCircle2, Trash2, Printer, FileDown, FileSpreadsheet, Share2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { fetchInvoiceItems, renderInvoiceSheetToPdf, exportInvoiceExcel } from '@/lib/invoiceExport';
import { openWhatsAppShare } from '@/lib/whatsapp';
import type { Customer } from '@/types/db';
import type { SalesInvoice } from '@/types/db';

export function SalesInvoicesPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();

  const [exportingId, setExportingId] = useState<string | null>(null);

  const handleRowExport = async (
    inv: { id: string; invoice_number: string; customer?: { name: string | null } | null },
    mode: 'pdf' | 'excel'
  ) => {
    if (!activeBusiness || exportingId) return;
    setExportingId(inv.id);
    try {
      const items = await fetchInvoiceItems(inv.id);
      const withCustomer = { ...inv, customer: (inv.customer ?? { name: null }) as Customer };
      if (mode === 'excel') {
        exportInvoiceExcel(activeBusiness, withCustomer as never, items);
        toast('Excel (.csv) exported', 'success');
      } else {
        await renderInvoiceSheetToPdf(activeBusiness, withCustomer as never, items, inv.customer?.name);
        toast('PDF exported', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setExportingId(null);
    }
  };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cancelTarget, setCancelTarget] = useState<SalesInvoice | null>(null);
  const [discardTarget, setDiscardTarget] = useState<SalesInvoice | null>(null);

  const { data: invoices, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-invoices', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('*, customer:customers(name,phone)')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as (SalesInvoice & { customer: { name: string; phone: string | null } | null })[];
    },
    enabled: !!activeBusiness,
  });

  const filtered = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => {
      const matchSearch = inv.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
        (inv.customer?.name || '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [invoices, search, statusFilter]);

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
      draft: 'neutral', issued: 'info', partially_paid: 'warning',
      paid: 'success', cancelled: 'error', void: 'error',
    };
    return map[status] || 'neutral';
  };

  const issueDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!activeBusiness) throw new Error('No business selected');
      const { error } = await supabase.rpc('issue_document', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'sales_invoice',
        p_doc_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ['sales-invoices', 'products', 'journal-entries', 'accounts', 'trial-balance', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast('Invoice issued — journal and stock posted', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to issue invoice', 'error'),
  });

  const discardDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!activeBusiness) throw new Error('No business selected');
      const { error } = await supabase.rpc('cancel_draft', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'sales_invoice',
        p_doc_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      toast('Draft discarded', 'success');
      setDiscardTarget(null);
    },
    onError: (err: any) => { setDiscardTarget(null); toast(err.message || 'Failed to discard draft', 'error'); },
  });

  const shareInvoice = (inv: SalesInvoice & { customer: { name: string; phone: string | null } | null }) => {
    const opened = openWhatsAppShare({
      partyName: inv.customer?.name || '',
      docNumber: inv.invoice_number,
      dateDDMMYYYY: formatDate(inv.invoice_date),
      amountInr: formatCurrency(inv.grand_total, activeBusiness?.currency_symbol || '\u20B9'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: inv.customer?.phone,
    });
    if (!opened) toast('Could not open WhatsApp — allow popups and try again', 'error');
  };

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !cancelTarget) throw new Error('No invoice selected');
      const { data: reversalId, error } = await supabase.rpc('cancel_sales_invoice', {
        p_invoice_id: cancelTarget.id,
      });
      if (error) throw error;
      return reversalId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast('Invoice cancelled and accounting reversed', 'success');
      setCancelTarget(null);
    },
    onError: (err: any) => toast(err.message || 'Failed to cancel invoice', 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Sales Invoices"
        subtitle={`${filtered.length} invoice${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/sales-invoices/new')}><Plus className="h-4 w-4" /> New Invoice</Button>}
      />

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <select className="input max-w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="partially_paid">Partial</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {isError ? (
          <ErrorState title="Unable to load sales invoices." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Create your first sales invoice to start tracking sales"
            action={<Button onClick={() => navigate('/app/sales-invoices/new')}><Plus className="h-4 w-4" /> New Invoice</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Invoice No.</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Balance</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => (
                  <tr key={inv.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <p className="font-medium text-primary-600 dark:text-primary-400">{inv.invoice_number}</p>
                    </td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{inv.customer?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(inv.invoice_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100">
                      {formatCurrency(inv.grand_total, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">
                      <span className={Number(inv.balance_amount) > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}>
                        {formatCurrency(inv.balance_amount, activeBusiness?.currency_symbol)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={statusVariant(inv.status)}>{inv.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => navigate(`/app/sales-invoices/${inv.id}`)}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                          title="View invoice"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => navigate(`/app/sales-invoices/${inv.id}?print=1`)}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-secondary-700 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors"
                          title="Print invoice"
                        >
                          <Printer className={`h-4 w-4 ${exportingId === inv.id ? 'animate-pulse' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleRowExport(inv, 'pdf')}
                          disabled={exportingId === inv.id}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors disabled:opacity-50"
                          title="Save as PDF"
                        >
                          <FileDown className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRowExport(inv, 'excel')}
                          disabled={exportingId === inv.id}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30 transition-colors disabled:opacity-50"
                          title="Export to Excel (.csv)"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => shareInvoice(inv)}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30 transition-colors"
                          title="Share on WhatsApp"
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                        {inv.status === 'draft' && (
                          <>
                            <button
                              onClick={() => issueDraftMutation.mutate(inv.id)}
                              className="p-1.5 rounded-lg text-secondary-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30 transition-colors"
                              title="Issue invoice"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDiscardTarget(inv)}
                              className="p-1.5 rounded-lg text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                              title="Discard draft"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {['issued', 'partially_paid', 'paid'].includes(inv.status) && (
                          <button
                            onClick={() => setCancelTarget(inv)}
                            className="p-1.5 rounded-lg text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                            title="Cancel invoice"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!discardTarget}
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => discardTarget && discardDraftMutation.mutate(discardTarget.id)}
        title="Discard draft?"
        message="Nothing was ever posted — the draft will be hard-deleted."
        confirmText="Discard"
        loading={discardDraftMutation.isPending}
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancel Invoice?"
        message={`This will cancel invoice ${cancelTarget?.invoice_number || ''} and post a reversal journal entry. Existing payments and stock movements are preserved.`}
        confirmText="Cancel Invoice"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
