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
import { PackageCheck, Plus, Lock, CheckCircle2, PackageOpen, Printer, Eye, Download, Pencil } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { renderDocSheetToPdf, renderDocSheetToPdfBlob, type PrintableDocData } from '@/lib/docPrint';
import {
  OrderInvoiceModal,
  mapPurchaseOrderToUniversalData,
  type UniversalDocumentData,
} from '@/components/documents';
import type { PurchaseOrder, PurchaseOrderItem, Supplier } from '@/types/db';

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
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<UniversalDocumentData | null>(null);
  const [convertTarget, setConvertTarget] = useState<(PurchaseOrder & { supplier: { name: string } | null }) | null>(null);
  const [convertDate, setConvertDate] = useState('');
  const [convertDue, setConvertDue] = useState('');

  const openConvert = (o: PurchaseOrder & { supplier: { name: string } | null }) => {
    setConvertTarget(o);
    setConvertDate(new Date().toISOString().slice(0, 10));
    setConvertDue('');
  };

  const fetchOrderDetails = async (o: PurchaseOrder) => {
    const { data: items, error } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', o.id)
      .order('created_at');
    if (error) throw error;

    let supplier: Partial<Supplier> | null = (o as any).supplier ?? null;
    if (o.supplier_id && (!supplier || !supplier.address)) {
      const { data: s } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', o.supplier_id)
        .maybeSingle();
      if (s) supplier = s;
    }

    const supplierAddress = [supplier?.address, supplier?.city, supplier?.state, supplier?.pincode]
      .filter(Boolean)
      .join(', ');

    const payload: PrintableDocData = {
      docTitle: 'PURCHASE ORDER',
      docNumber: o.order_number,
      dateLabel: 'Order Date',
      dateValue: formatDate(o.order_date),
      expiryLabel: 'Expected On',
      expiryValue: o.expected_date,
      partyLabel: 'Supplier',
      partyName: supplier?.company_name || supplier?.name || (o as any).supplier?.name || '—',
      partyAddress: supplierAddress || undefined,
      partyGstin: supplier?.gstin || undefined,
      partyPhone: supplier?.phone || undefined,
      partyPlaceOfSupply: activeBusiness?.state || 'Uttar Pradesh',
      isPurchaseBill: true,
      status: o.status,
      items: (items || []) as PurchaseOrderItem[],
      subtotal: Number(o.subtotal),
      taxableAmount: Number(o.taxable_amount),
      cgst: Number(o.cgst_amount),
      sgst: Number(o.sgst_amount),
      igst: Number(o.igst_amount),
      roundOff: Number(o.round_off) || 0,
      grandTotal: Number(o.grand_total),
      notes: o.notes,
    };

    return { items: (items || []) as PurchaseOrderItem[], supplier, payload };
  };

  const handlePreviewOrder = async (o: PurchaseOrder) => {
    if (!activeBusiness) return;
    setPreviewLoadingId(o.id);
    try {
      const { items, supplier } = await fetchOrderDetails(o);
      const universal = mapPurchaseOrderToUniversalData(
        activeBusiness,
        { ...o, supplier },
        items
      );
      setPreviewData(universal);
    } catch (err: any) {
      toast(err?.message || 'Failed to load order preview', 'error');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const printOrder = async (o: PurchaseOrder) => {
    if (!activeBusiness) return;
    setPrintingId(o.id);
    try {
      const { payload } = await fetchOrderDetails(o);
      await renderDocSheetToPdf(activeBusiness, payload);
    } catch (err: any) {
      toast(err?.message || 'PDF export failed', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const handleDownloadPdf = async (o: PurchaseOrder) => {
    if (!activeBusiness) return;
    setDownloadingId(o.id);
    try {
      const { payload } = await fetchOrderDetails(o);
      const blob = await renderDocSheetToPdfBlob(activeBusiness, payload);
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${o.order_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      toast(err?.message || 'Download PDF failed', 'error');
    } finally {
      setDownloadingId(null);
    }
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
                          loading={previewLoadingId === o.id}
                          onClick={() => handlePreviewOrder(o)}
                          title="Preview Purchase Order in GST format"
                        >
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={printingId === o.id}
                          onClick={() => printOrder(o)}
                          title="Print Purchase Order in clean A4 format"
                        >
                          <Printer className="h-3 w-3" /> Print
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={downloadingId === o.id}
                          onClick={() => handleDownloadPdf(o)}
                          title="Download Purchase Order as PDF"
                        >
                          <Download className="h-3 w-3" /> PDF
                        </Button>
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

      <OrderInvoiceModal
        open={!!previewData}
        onClose={() => setPreviewData(null)}
        data={previewData}
        title={previewData ? `Purchase Order - ${previewData.documentNumber}` : 'Purchase Order'}
      />
    </div>
  );
}
