import { useState } from 'react';
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
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { PackageCheck, Plus, Lock, CheckCircle2, PackageOpen, Eye, Pencil, Printer, Download, Loader2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { printDocument, downloadDocumentPdf } from '@/lib/documentActions';
import type { PurchaseOrder } from '@/types/db';

type LineItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  tax_rate: number;
};

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  confirmed: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  received: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  converted: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  cancelled: 'bg-secondary-100 text-secondary-400 dark:bg-secondary-800 dark:text-secondary-500 line-through',
};

const LOCKED: Record<string, boolean> = { received: true, converted: true, cancelled: true };
const CAN_CONVERT: Record<string, boolean> = { confirmed: true, received: true };

const convertHint = (status: string) =>
  status === 'converted' ? 'Already converted'
  : status === 'cancelled' ? 'Cancelled documents cannot be converted'
  : !CAN_CONVERT[status] ? 'Only confirmed or received orders can be converted'
  : 'Convert to purchase bill';

export function PurchaseOrdersPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirmCancel, setConfirmCancel] = useState<PurchaseOrder | null>(null);
  const [convertTarget, setConvertTarget] = useState<(PurchaseOrder & { supplier: { name: string } | null }) | null>(null);
  const [convertDate, setConvertDate] = useState('');
  const [convertDue, setConvertDue] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const handlePrint = (id: string) => {
    printDocument('purchase_order', id, activeBusiness, navigate);
  };

  const handleDownload = async (id: string) => {
    if (!activeBusiness || actionLoadingId) return;
    setActionLoadingId(`${id}-download`);
    try {
      await downloadDocumentPdf('purchase_order', id, activeBusiness);
      toast('PDF downloaded', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to download PDF', 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const openConvert = (o: PurchaseOrder & { supplier: { name: string } | null }) => {
    setConvertTarget(o);
    setConvertDate(new Date().toISOString().slice(0, 10));
    setConvertDue('');
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['purchase-orders', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize, status: statusFilter }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as (PurchaseOrder & { supplier: { name: string; phone?: string | null; company_name?: string | null; address?: string | null; city?: string | null; state?: string | null; pincode?: string | null; gstin?: string | null } | null })[], total: 0 };
      const pattern = list.debouncedSearch ? likePattern(list.debouncedSearch) : null;
      const run = async (withJoin: boolean) => {
        let q = supabase.from('purchase_orders')
          .select((withJoin ? '*, supplier:suppliers(name,phone,company_name,address,city,state,pincode,gstin)' : '*') as string, { count: 'exact' })
          .eq('business_id', activeBusiness.id);
        if (statusFilter !== 'all') q = q.eq('status', statusFilter);
        if (pattern) {
          q = withJoin
            ? q.or(`order_number.ilike."${pattern}",supplier.name.ilike."${pattern}"`)
            : q.or(`order_number.ilike."${pattern}"`);
        }
        return q.order('created_at', { ascending: false }).range(list.from, list.to);
      };
      let res = await run(true);
      if (res.error) res = await run(false);
      if (res.error) return { rows: [] as unknown as (PurchaseOrder & { supplier: { name: string } | null })[], total: 0 };
      return { rows: (res.data || []) as unknown as (PurchaseOrder & { supplier: { name: string } | null })[], total: res.count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const orders = data?.rows ?? [];
  const totalOrders = data?.total ?? 0;

  const invalidateAll = () => {
    ['purchase-orders', 'dashboard-stats'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
    );
  };

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      if (!activeBusiness) throw new Error('No active business');
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id).eq('business_id', activeBusiness.id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      invalidateAll();
      toast(status === 'confirmed' ? 'Purchase order confirmed' : status === 'received' ? 'Purchase order marked as received' : 'Purchase order cancelled', 'success');
      setConfirmCancel(null);
    },
    onError: (err: any) => { setConfirmCancel(null); toast(err.message || 'Status update failed', 'error'); },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !convertTarget) throw new Error('Nothing to convert');
      const attempt = async (idKey: string) =>
        supabase.rpc('convert_purchase_order_to_bill', {
          p_business_id: activeBusiness!.id,
          [idKey]: convertTarget!.id,
          p_bill_date: convertDate,
          p_due_date: convertDue || null,
        });
      let res = await attempt('p_purchase_order_id');
      if (res.error && /could not find function|candidate function/i.test(res.error.message)) {
        res = await attempt('p_order_id');
      }
      if (res.error) throw res.error;
      return res.data as { new_doc_id: string; new_doc_number: string } | null;
    },
    onSuccess: (d) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
      setConvertTarget(null);
      toast(`Converted to ${d?.new_doc_number || 'bill'}`, 'success');
    },
    onError: (err: any) => toast(err.message || 'Conversion failed', 'error'),
  });

  return (
    <div>
      <PageHeader title="Purchase Orders" subtitle={`${totalOrders} order${totalOrders !== 1 ? 's' : ''} placed with suppliers`}
        actions={<Button onClick={() => navigate('/app/purchase-orders/new')}><Plus className="h-4 w-4" /> New Purchase Order</Button>} />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number, supplier, or reference..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
          leftAddon={(
            <div className="max-w-[15rem] min-w-[9.5rem]">
              <select
                className="input h-9 py-0 leading-none text-sm cursor-pointer"
                aria-label="Purchase order status filter"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); list.setPage(1); }}
              >
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="confirmed">Confirmed</option>
                <option value="received">Received</option>
                <option value="converted">Converted</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}
        >
          <DataTableExportToolbar
            columns={[
              { key: 'number', label: 'Order No.', getText: (o) => o.order_number },
              { key: 'date', label: 'Date', getText: (o) => formatDate(o.order_date) },
              { key: 'supplier', label: 'Supplier', getText: (o) => o.supplier?.name || '—' },
              { key: 'total', label: 'Total', getText: (o) => formatCurrency(o.grand_total, activeBusiness?.currency_symbol) },
              { key: 'status', label: 'Status', getText: (o) => o.status },
            ]}
            rows={orders}
            filename="purchase-orders"
            title="Purchase Orders"
            storageKey="purchase-orders"
          />
        </ListToolbar>
        {isError ? (
          <ErrorState title="Unable to load purchase orders." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : orders.length === 0 ? (
          <EmptyState icon={PackageCheck} title="No purchase orders yet" description="Create your first purchase order"
            action={<Button onClick={() => navigate('/app/purchase-orders/new')}><Plus className="h-4 w-4" /> New Purchase Order</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Order No.</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Supplier</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-500">{o.order_number}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(o.order_date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-900 dark:text-secondary-100">{o.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium figure">{formatCurrency(o.grand_total, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusStyles[o.status]}`}>{o.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5" title={LOCKED[o.status] ? `Terminal state (${o.status}) — immutable` : undefined}>
                        {!LOCKED[o.status] && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/app/purchase-orders/${o.id}/edit`)}
                            title="Edit Purchase Order"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/app/purchase-orders/${o.id}`)}
                          title="Open the purchase order detail page"
                        >
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <button
                          onClick={() => handlePrint(o.id)}
                          disabled={!!actionLoadingId}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-secondary-400 dark:hover:text-secondary-100 transition-colors disabled:opacity-50 group"
                          title="Print Purchase Order"
                          aria-label="Print Purchase Order"
                        >
                          {actionLoadingId === `${o.id}-print` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" />
                          ) : (
                            <Printer className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:text-secondary-400 dark:group-hover:text-secondary-200" />
                          )}
                          <span>Print</span>
                        </button>
                        <button
                          onClick={() => handleDownload(o.id)}
                          disabled={!!actionLoadingId}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:text-secondary-400 dark:hover:text-secondary-100 transition-colors disabled:opacity-50 group"
                          title="Download PDF"
                          aria-label="Download PDF"
                        >
                          {actionLoadingId === `${o.id}-download` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary-600" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:text-secondary-400 dark:group-hover:text-secondary-200" />
                          )}
                          <span>PDF</span>
                        </button>
                        {LOCKED[o.status] && (
                          <span className="inline-flex items-center gap-1 text-xs text-secondary-400"><Lock className="h-3 w-3" /> Locked</span>
                        )}
                        {!LOCKED[o.status] && o.status === 'draft' && (
                          <Button size="sm" onClick={() => statusMutation.mutate({ id: o.id, status: 'confirmed' })} loading={statusMutation.isPending}>
                            <CheckCircle2 className="h-3 w-3" /> Confirm
                          </Button>
                        )}
                        {!LOCKED[o.status] && o.status === 'confirmed' && (
                          <>
                            <Button size="sm" onClick={() => statusMutation.mutate({ id: o.id, status: 'received' })}>
                              <PackageOpen className="h-3 w-3" /> Receive
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(o)}>Cancel</Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant={CAN_CONVERT[o.status] ? 'primary' : 'secondary'}
                          disabled={!CAN_CONVERT[o.status]}
                          title={convertHint(o.status)}
                          onClick={() => openConvert(o)}
                        >
                          Convert
                        </Button>
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
          from={list.from}
          total={totalOrders}
          isLoading={isLoading}
        />
      </div>

      <ConfirmDialog
        open={!!confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={() => confirmCancel && statusMutation.mutate({ id: confirmCancel.id, status: 'cancelled' })}
        title="Cancel purchase order?"
        message="The order will be marked cancelled and become immutable."
        confirmText="Cancel Order"
        loading={statusMutation.isPending}
      />

      <Modal open={!!convertTarget} onClose={() => setConvertTarget(null)} title="Convert to Purchase Bill" size="sm">
        <p className="text-sm text-secondary-500 dark:text-secondary-400 mb-4">
          Converting purchase order <span className="font-semibold text-secondary-900 dark:text-secondary-100">{convertTarget?.order_number}</span>
          {convertTarget?.supplier?.name ? ` for ${convertTarget.supplier.name}` : ''}. Items, taxes and totals carry over.
        </p>
        <div className="space-y-4">
          <FormField label="Bill Date" required>
            <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} />
          </FormField>
          <FormField label="Due Date (optional)">
            <Input type="date" value={convertDue} onChange={(e) => setConvertDue(e.target.value)} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setConvertTarget(null)}>Cancel</Button>
          <Button onClick={() => convertMutation.mutate()} loading={convertMutation.isPending} disabled={!convertDate}>Convert</Button>
        </div>
      </Modal>

    </div>
  );
}
