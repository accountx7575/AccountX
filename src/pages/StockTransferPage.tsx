import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { usePagedList } from '@/hooks/usePagedList';
import { formatDate, formatCurrency } from '@/lib/utils';

type WarehouseLite = { id: string; name: string };

type TransferRow = {
  id: string;
  transfer_number: string;
  status: 'completed' | 'cancelled';
  from_warehouse_id: string;
  to_warehouse_id: string;
  notes: string | null;
  created_at: string;
};

type TransferLineRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost: number | null;
  product: { name: string; unit: string } | null;
};

const statusStyles: Record<string, string> = {
  completed: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  cancelled: 'bg-secondary-100 text-secondary-400 dark:bg-secondary-800 dark:text-secondary-500 line-through',
};

export function StockTransferPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [confirmCancel, setConfirmCancel] = useState<TransferRow | null>(null);
  const [viewing, setViewing] = useState<TransferRow | null>(null);

  const { data: transfers, isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-transfers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as TransferRow[];
      const { data, error } = await supabase
        .from('stock_transfers')
        .select('id, transfer_number, status, from_warehouse_id, to_warehouse_id, notes, created_at')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []) as TransferRow[];
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as WarehouseLite[];
      const { data } = await supabase
        .from('warehouses')
        .select('id, name')
        .eq('business_id', activeBusiness.id)
        .order('name');
      return (data || []) as WarehouseLite[];
    },
    enabled: !!activeBusiness,
  });

  const whName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses || []) m.set(w.id, w.name);
    return m;
  }, [warehouses]);

  const filtered = useMemo(() => {
    const q = list.debouncedSearch.trim().toLowerCase();
    if (!q) return transfers || [];
    return (transfers || []).filter(
      (t) =>
        t.transfer_number.toLowerCase().includes(q) ||
        (whName.get(t.from_warehouse_id) || '').toLowerCase().includes(q) ||
        (whName.get(t.to_warehouse_id) || '').toLowerCase().includes(q)
    );
  }, [transfers, whName, list.debouncedSearch]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);

  const cancelMutation = useMutation({
    mutationFn: async (transferId: string) => {
      const { error } = await supabase.rpc('cancel_stock_transfer', { p_transfer_id: transferId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-transfers-lines'] });
      toast('Stock transfer cancelled — reversal movements posted', 'success');
      setConfirmCancel(null);
    },
    onError: (err: any) => {
      setConfirmCancel(null);
      toast(err.message || 'Failed to cancel transfer', 'error');
    },
  });

  return (
    <div>
      <PageHeader
        title="Stock Transfers"
        subtitle={`${filtered.length} transfer${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/stock-transfer/new')}><Plus className="h-4 w-4" /> New Transfer</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number or warehouse..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {isError ? (
          <ErrorState title="Unable to load stock transfers." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : pageRows.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No stock transfers yet"
            description={list.search ? 'No transfer matches your search.' : 'Move stock between your warehouses with full movement history.'}
            action={<Button onClick={() => navigate('/app/stock-transfer/new')}><Plus className="h-4 w-4" /> New Transfer</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Transfer No.</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Route</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Notes</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((t) => (
                  <tr key={t.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-primary-600 dark:text-primary-400">{t.transfer_number}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">
                      <span className="inline-flex items-center gap-1.5">
                        {whName.get(t.from_warehouse_id) || '—'}
                        <ArrowLeftRight className="h-3 w-3 text-secondary-400 shrink-0" aria-label="to" />
                        {whName.get(t.to_warehouse_id) || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-500 max-w-[12rem] truncate">{t.notes || '—'}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusStyles[t.status]}`}>{t.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end items-center gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setViewing(t)}>View</Button>
                        {t.status === 'completed' ? (
                          <Button size="sm" variant="secondary" onClick={() => setConfirmCancel(t)}>Cancel</Button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-secondary-400"><Lock className="h-3 w-3" /> Locked</span>
                        )}
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
          total={filtered.length}
          isLoading={isLoading}
        />
      </div>

      <Drawer open={!!viewing} onClose={() => setViewing(null)} width="md" title={`Transfer ${viewing?.transfer_number ?? ''}`}>
        {viewing && <TransferLines transferId={viewing.id} />}
      </Drawer>

      <ConfirmDialog
        open={!!confirmCancel}
        onClose={() => setConfirmCancel(null)}
        onConfirm={() => confirmCancel && cancelMutation.mutate(confirmCancel.id)}
        title="Cancel this stock transfer?"
        message="Reversal movements will be posted automatically both ways and the transfer becomes immutable. This cannot be undone."
        confirmText="Cancel Transfer"
        loading={cancelMutation.isPending}
      />
    </div>
  );
}

function TransferLines({ transferId }: { transferId: string }) {
  const { activeBusiness } = useAuth();
  const lines = useQuery({
    queryKey: ['stock-transfer-lines', transferId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_transfer_lines')
        .select('id, product_id, quantity, unit_cost, product:products(name, unit)')
        .eq('transfer_id', transferId);
      if (error) throw new Error(error.message);
      return ((data || []) as unknown) as TransferLineRow[];
    },
  });

  if (lines.isError) return <ErrorState title="Unable to load transfer line items." onRetry={() => lines.refetch()} />;
  if (lines.isLoading)
    return <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>;
  if (!lines.data || lines.data.length === 0)
    return <EmptyState icon={ArrowLeftRight} title="No line items" description="This transfer has no recorded lines." />;

  return (
    <div>
      <p className="text-xs text-secondary-400 mb-3">FIFO consumption cost is captured per line for audit — inventory value is preserved across the move.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
            <th className="text-left px-3 py-2 font-medium">Product</th>
            <th className="text-right px-3 py-2 font-medium">Qty</th>
            <th className="text-right px-3 py-2 font-medium">Unit cost</th>
          </tr>
        </thead>
        <tbody>
          {lines.data.map((l) => (
            <tr key={l.id} className="border-b border-secondary-100 dark:border-secondary-800/50">
              <td className="px-3 py-2 text-secondary-900 dark:text-secondary-100">{l.product?.name || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums figure">{l.quantity} {l.product?.unit || ''}</td>
              <td className="px-3 py-2 text-right tabular-nums figure text-secondary-500">
                {l.unit_cost != null ? formatCurrency(l.unit_cost) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
