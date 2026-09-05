import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Input, FormField } from '@/components/ui/Input';
import { ListPagination } from '@/components/ui/ListControls';
import { usePagedList } from '@/hooks/usePagedList';
import {
  ClipboardList,
  Plus,
  Lock,
  Send,
  Check,
  X,
  Printer,
  Mail,
  Eye,
  Pencil,
  MessageCircle,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { renderDocSheetToPdf, type PrintableDocData } from '@/lib/docPrint';
import { openWhatsAppShare } from '@/lib/whatsapp';
import type { Quotation, QuotationItem } from '@/types/db';

type QuoteRow = Quotation & { customer: { name: string; phone: string | null; email: string | null } | null };

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

const CONVERT_TARGETS = {
  invoice: {
    modalTitle: 'Convert to Tax Invoice',
    dateLabel: 'Invoice Date',
    hint: 'Convert to tax invoice',
  },
  sales_order: {
    modalTitle: 'Convert to Sales Order',
    dateLabel: 'Order Date',
    hint: 'Convert to sales order',
  },
} as const;

type ConvertMode = keyof typeof CONVERT_TARGETS;

const convertHint = (status: string, mode: ConvertMode) =>
  status === 'converted' ? 'Already converted'
  : status === 'cancelled' ? 'Cancelled documents cannot be converted'
  : !CAN_CONVERT[status] ? 'Only sent or accepted quotations can be converted'
  : CONVERT_TARGETS[mode].hint;

type SortField = 'quotation_number' | 'quote_date';
type SortOrder = 'asc' | 'desc';

export function QuotationsPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('quote_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [confirmCancel, setConfirmCancel] = useState<Quotation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuoteRow | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<QuoteRow | null>(null);
  const [convertDate, setConvertDate] = useState('');
  const [convertDue, setConvertDue] = useState('');
  const [convertMode, setConvertMode] = useState<ConvertMode>('invoice');

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'quotation_number' ? 'asc' : 'desc');
    }
  };

  const openConvert = (q: QuoteRow, mode: ConvertMode) => {
    setConvertTarget(q);
    setConvertMode(mode);
    setConvertDate(new Date().toISOString().slice(0, 10));
    setConvertDue('');
  };

  const shareWhatsApp = (q: QuoteRow) => {
    const opened = openWhatsAppShare({
      partyName: q.customer?.name || '',
      docNumber: q.quotation_number,
      dateDDMMYYYY: formatDate(q.quote_date),
      amountInr: formatCurrency(q.grand_total, activeBusiness?.currency_symbol || '₹'),
      bank: {
        name: activeBusiness?.bank_name,
        ifsc: activeBusiness?.bank_ifsc_code,
        upi: activeBusiness?.upi_id,
      },
      partyPhone: q.customer?.phone,
    });
    if (!opened) toast('Could not open WhatsApp — allow popups and try again', 'error');
  };

  const printQuote = async (q: QuoteRow) => {
    if (!activeBusiness) return;
    setPrintingId(q.id);
    try {
      const { data: items, error } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', q.id)
        .order('created_at');
      if (error) throw error;
      const payload: Omit<PrintableDocData, 'businessName' | 'gstin'> = {
        docTitle: 'QUOTATION',
        docNumber: q.quotation_number,
        dateLabel: 'Quote Date',
        dateValue: formatDate(q.quote_date),
        expiryLabel: 'Valid Until',
        expiryValue: q.expiry_date,
        partyLabel: 'Customer',
        partyName: q.customer?.name || '—',
        status: q.status,
        items: (items || []) as QuotationItem[],
        subtotal: Number(q.subtotal),
        taxableAmount: Number(q.taxable_amount),
        cgst: Number(q.cgst_amount),
        sgst: Number(q.sgst_amount),
        igst: Number(q.igst_amount),
        roundOff: Number(q.round_off) || 0,
        grandTotal: Number(q.grand_total),
        notes: q.notes,
        terms: q.terms,
      };
      await renderDocSheetToPdf(activeBusiness, payload);
    } catch (err: any) {
      toast(err?.message || 'PDF export failed', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const { data: rawData, isLoading, isError, refetch } = useQuery({
    queryKey: ['quotations-data', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as QuoteRow[];

      const { data: qRows, error } = await supabase
        .from('quotations')
        .select('*, customer:customers(name,phone,email)')
        .eq('business_id', activeBusiness.id);

      if (error) {
        const { data: fallbackRows, error: fallbackErr } = await supabase
          .from('quotations')
          .select('*')
          .eq('business_id', activeBusiness.id);
        if (fallbackErr) throw fallbackErr;
        return (fallbackRows || []) as unknown as QuoteRow[];
      }

      return (qRows || []) as unknown as QuoteRow[];
    },
    enabled: !!activeBusiness,
  });

  const processedQuotes = useMemo(() => {
    let listData = [...(rawData || [])];

    if (statusFilter !== 'all') {
      listData = listData.filter((q) => q.status.toLowerCase() === statusFilter.toLowerCase());
    }

    if (list.search.trim()) {
      const qLower = list.search.trim().toLowerCase();
      listData = listData.filter(
        (q) =>
          q.quotation_number.toLowerCase().includes(qLower) ||
          q.customer?.name?.toLowerCase().includes(qLower)
      );
    }

    listData.sort((a, b) => {
      if (sortField === 'quote_date') {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : new Date(a.quote_date).getTime();
        const timeB = b.created_at ? new Date(b.created_at).getTime() : new Date(b.quote_date).getTime();
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      } else {
        const numA = parseInt(a.quotation_number.match(/\d+$/)?.[0] || '0', 10);
        const numB = parseInt(b.quotation_number.match(/\d+$/)?.[0] || '0', 10);
        return sortOrder === 'asc' ? numA - numB : numB - numA;
      }
    });

    return listData;
  }, [rawData, statusFilter, list.search, sortField, sortOrder]);

  const totalQuotes = processedQuotes.length;
  const pagedQuotes = useMemo(() => {
    const from = (list.page - 1) * list.pageSize;
    return processedQuotes.slice(from, from + list.pageSize);
  }, [processedQuotes, list.page, list.pageSize]);

  const invalidateAll = () => {
    ['quotations-data', 'dashboard-stats'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k] })
    );
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!activeBusiness) throw new Error('No active business');
      const { error } = await supabase
        .from('quotations')
        .update({ status })
        .eq('id', id)
        .eq('business_id', activeBusiness.id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      invalidateAll();
      toast(
        status === 'sent'
          ? 'Quotation marked sent'
          : status === 'accepted'
          ? 'Quotation accepted'
          : status === 'rejected'
          ? 'Quotation rejected'
          : 'Quotation cancelled',
        'success'
      );
      setConfirmCancel(null);
    },
    onError: (err: any) => {
      setConfirmCancel(null);
      toast(err.message || 'Status update failed', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      if (!activeBusiness) throw new Error('No active business');

      const { error: itemsErr } = await supabase
        .from('quotation_items')
        .delete()
        .eq('quotation_id', quoteId);
      if (itemsErr) throw itemsErr;

      const { error: quoteErr } = await supabase
        .from('quotations')
        .delete()
        .eq('id', quoteId)
        .eq('business_id', activeBusiness.id);
      if (quoteErr) throw quoteErr;

      return quoteId;
    },
    onSuccess: () => {
      invalidateAll();
      toast('Quotation deleted successfully', 'success');
      setConfirmDelete(null);
    },
    onError: (err: any) => {
      setConfirmDelete(null);
      toast(err?.message || 'Failed to delete quotation', 'error');
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !convertTarget) throw new Error('Nothing to convert');
      const { data, error } = await supabase.rpc('convert_quotation_to_invoice', {
        p_business_id: activeBusiness.id,
        p_quotation_id: convertTarget.id,
        p_invoice_date: convertDate,
        p_due_date: convertDue || null,
      });
      if (error) throw error;
      return data as { new_doc_id: string; new_doc_number: string } | null;
    },
    onSuccess: (d) => {
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
      if (!activeBusiness || !convertTarget) throw new Error('Nothing to convert');
      const { data, error } = await supabase.rpc('convert_quotation_to_sales_order', {
        p_quotation_id: convertTarget.id,
        p_order_date: convertDate,
      });
      if (error) throw error;
      return data as { new_doc_id: string; new_doc_number: string } | null;
    },
    onSuccess: (d) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['sales-orders', activeBusiness?.id] });
      setConvertTarget(null);
      toast(`Converted to ${d?.new_doc_number || 'sales order'}`, 'success');
      navigate('/app/sales-orders');
    },
    onError: (err: any) => toast(err.message || 'Conversion failed', 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle={`${totalQuotes} quotation${totalQuotes !== 1 ? 's' : ''}`}
        actions={
          <Button onClick={() => navigate('/app/quotations/new')}>
            <Plus className="h-4 w-4" /> New Quotation
          </Button>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2 max-w-lg">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
              <input
                type="text"
                value={list.search}
                onChange={(e) => {
                  list.setSearch(e.target.value);
                  list.setPage(1);
                }}
                placeholder="Search by number or customer..."
                className="input pl-9 text-sm w-full"
              />
            </div>

            <select
              className="input text-sm w-36 cursor-pointer font-medium"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                list.setPage(1);
              }}
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="converted">Converted</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary-500">Rows:</span>
            <select
              className="input text-sm w-20 cursor-pointer"
              value={list.pageSize}
              onChange={(e) => {
                list.setPageSize(Number(e.target.value));
                list.setPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {isError ? (
          <ErrorState title="Unable to load quotations." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
            ))}
          </div>
        ) : pagedQuotes.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No quotations found"
            description={
              statusFilter !== 'all'
                ? `No quotations with status "${statusFilter}".`
                : 'Create your first quotation'
            }
            action={
              <Button onClick={() => navigate('/app/quotations/new')}>
                <Plus className="h-4 w-4" /> New Quotation
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400 select-none">
                  <th
                    className="text-left px-4 py-3 font-medium cursor-pointer hover:text-primary-600 transition-colors"
                    onClick={() => toggleSort('quotation_number')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Quote No.</span>
                      {sortField === 'quotation_number' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-primary-600" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-primary-600" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  <th
                    className="text-left px-4 py-3 font-medium hidden sm:table-cell cursor-pointer hover:text-primary-600 transition-colors"
                    onClick={() => toggleSort('quote_date')}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Date & Time</span>
                      {sortField === 'quote_date' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-primary-600" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-primary-600" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-40 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Customer</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedQuotes.map((q) => (
                  <tr key={q.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">
                      <button
                        onClick={() => navigate(`/app/quotations/${q.id}`)}
                        className="hover:text-primary-600 hover:underline font-semibold text-left"
                      >
                        {q.quotation_number}
                      </button>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">
                      <div className="font-medium text-secondary-900 dark:text-secondary-100">
                        {formatDate(q.quote_date)}
                      </div>
                      <div className="text-[11px] text-secondary-400">
                        {q.created_at
                          ? new Date(q.created_at).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })
                          : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-900 dark:text-secondary-100">
                      {q.customer?.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium figure">
                      {formatCurrency(q.grand_total, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${statusStyles[q.status]}`}>{q.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => navigate(`/app/quotations/${q.id}`)}
                          className="p-1.5 rounded-md text-secondary-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                          title="View Quotation"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {!LOCKED[q.status] && (
                          <button
                            onClick={() => navigate(`/app/quotations/${q.id}/edit`)}
                            className="p-1.5 rounded-md text-secondary-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="Edit Quotation"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}

                        <Button size="sm" variant="ghost" loading={printingId === q.id} onClick={() => printQuote(q)} title="Download PDF">
                          <Printer className="h-3 w-3" /> PDF
                        </Button>

                        {LOCKED[q.status] && (
                          <span className="inline-flex items-center gap-1 text-xs text-secondary-400">
                            <Lock className="h-3 w-3" /> Locked
                          </span>
                        )}

                        {!LOCKED[q.status] && q.status === 'draft' && (
                          <Button size="sm" onClick={() => statusMutation.mutate({ id: q.id, status: 'sent' })} loading={statusMutation.isPending}>
                            <Send className="h-3 w-3" /> Send
                          </Button>
                        )}

                        {!LOCKED[q.status] && q.status === 'sent' && (
                          <>
                            <Button size="sm" onClick={() => statusMutation.mutate({ id: q.id, status: 'accepted' })}>
                              <Check className="h-3 w-3" /> Accept
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => statusMutation.mutate({ id: q.id, status: 'rejected' })}>
                              <X className="h-3 w-3" /> Reject
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(q)}>
                              Cancel
                            </Button>
                          </>
                        )}

                        <Button
                          size="sm"
                          variant={CAN_CONVERT[q.status] ? 'primary' : 'secondary'}
                          disabled={!CAN_CONVERT[q.status]}
                          title={convertHint(q.status, 'invoice')}
                          onClick={() => openConvert(q, 'invoice')}
                        >
                          Convert
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!CAN_CONVERT[q.status]}
                          title={convertHint(q.status, 'sales_order')}
                          onClick={() => openConvert(q, 'sales_order')}
                        >
                          To SO
                        </Button>

                        <Button size="sm" variant="ghost" onClick={() => shareWhatsApp(q)} title="Share on WhatsApp">
                          <MessageCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> WhatsApp
                        </Button>

                        {/* Dedicated Full Page Route Navigation */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/app/quotations/${q.id}/send`)}
                          title="Email Quotation"
                        >
                          <Mail className="h-3 w-3" /> Email
                        </Button>

                        <button
                          onClick={() => setConfirmDelete(q)}
                          className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                          title="Delete Quotation"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ListPagination
          page={list.page}
          onPageChange={list.setPage}
          pageSize={list.pageSize}
          from={(list.page - 1) * list.pageSize}
          total={totalQuotes}
          isLoading={isLoading}
        />
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
        title={`Delete Quotation ${confirmDelete?.quotation_number || ''}?`}
        message="Are you sure you want to delete this quotation? This action cannot be undone."
        confirmText="Delete"
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={!!confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={() => confirmCancel && statusMutation.mutate({ id: confirmCancel.id, status: 'cancelled' })}
        title="Cancel quotation?"
        message="The quotation will be marked cancelled and become immutable."
        confirmText="Cancel Quote"
        loading={statusMutation.isPending}
      />

      <Modal open={!!convertTarget} onClose={() => setConvertTarget(null)} title={CONVERT_TARGETS[convertMode].modalTitle} size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-4">
          Converting quotation <span className="font-semibold text-secondary-900 dark:text-secondary-100">{convertTarget?.quotation_number}</span>
          {convertTarget?.customer?.name ? ` for ${convertTarget.customer.name}` : ''}.
        </p>
        <div className="space-y-4">
          <FormField label={CONVERT_TARGETS[convertMode].dateLabel} required>
            <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
          </FormField>
          {convertMode === 'invoice' && (
            <FormField label="Due Date (optional)">
              <Input type="date" value={convertDue} onChange={(e) => setConvertDue(e.target.value)} />
            </FormField>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setConvertTarget(null)}>Cancel</Button>
          <Button
            onClick={() => (convertMode === 'invoice' ? convertMutation.mutate() : convertSoMutation.mutate())}
            loading={convertMutation.isPending || convertSoMutation.isPending}
            disabled={!convertDate}
          >
            Convert
          </Button>
        </div>
      </Modal>
    </div>
  );
}