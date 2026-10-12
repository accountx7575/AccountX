import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast, sanitizeUserFacingError } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ShoppingCart, Plus, Search, Ban, CheckCircle2, Trash2, Printer } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { renderDocSheetToPdf, type PrintableDocData } from '@/lib/docPrint';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import type { PurchaseBill, PurchaseBillItem, Supplier } from '@/types/db';

export function PurchaseBillsPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState<PurchaseBill | null>(null);
  const [discardTarget, setDiscardTarget] = useState<PurchaseBill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseBill | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const printBill = async (b: PurchaseBill & { supplier: { name: string } | null }) => {
    if (!activeBusiness) return;
    setPrintingId(b.id);
    try {
      const { data: items, error } = await supabase
        .from('purchase_bill_items')
        .select('*')
        .eq('bill_id', b.id)
        .order('created_at');
      if (error) throw error;
      // Full supplier row for the swapped print parties: Billed By = vendor.
      const { data: supplier, error: supplierError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', b.supplier_id)
        .maybeSingle();
      if (supplierError) throw supplierError;
      const s = (supplier ?? null) as Supplier | null;
      const supplierAddress = [s?.address, s?.city, s?.state, s?.pincode].filter(Boolean).join(', ');
      const payload: Omit<PrintableDocData, 'businessName' | 'gstin'> = {
        docTitle: 'PURCHASE BILL',
        docNumber: b.bill_number,
        dateLabel: 'Bill Date',
        dateValue: formatDate(b.bill_date),
        expiryLabel: 'Due Date',
        expiryValue: b.due_date,
        partyLabel: 'Supplier',
        partyName: s?.company_name || s?.name || b.supplier?.name || '—',
        partyAddress: supplierAddress || undefined,
        partyGstin: s?.gstin || undefined,
        partyPhone: s?.phone || undefined,
        isPurchaseBill: true,
        status: b.status,
        items: (items || []) as PurchaseBillItem[],
        subtotal: Number(b.subtotal),
        taxableAmount: Number(b.taxable_amount),
        cgst: Number(b.cgst_amount),
        sgst: Number(b.sgst_amount),
        igst: Number(b.igst_amount),
        roundOff: Number(b.round_off) || 0,
        grandTotal: Number(b.grand_total),
        notes: b.notes,
      };
      await renderDocSheetToPdf(activeBusiness, payload);
    } catch (err: any) {
      toast(err?.message || 'PDF export failed', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const { data: bills, isLoading, isError, refetch } = useQuery({
    queryKey: ['purchase-bills', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data, error } = await supabase
        .from('purchase_bills')
        .select('*, supplier:suppliers(name)')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as (PurchaseBill & { supplier: { name: string } | null })[];
    },
    enabled: !!activeBusiness,
  });

  const filtered = useMemo(() => {
    if (!bills) return [];
    return bills.filter((b) =>
      b.bill_number.toLowerCase().includes(search.toLowerCase()) ||
      (b.supplier?.name || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [bills, search]);

  const statusVariant = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
      draft: 'neutral', confirmed: 'info', partially_paid: 'warning',
      paid: 'success', cancelled: 'error',
    };
    return map[status] || 'neutral';
  };

  const issueDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!activeBusiness) throw new Error('No business selected');
      const { error } = await supabase.rpc('issue_document', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'purchase_bill',
        p_doc_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ['purchase-bills', 'products', 'journal-entries', 'accounts', 'trial-balance', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast('Bill confirmed — journal and stock posted', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to confirm bill', 'error'),
  });

  const discardDraftMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!activeBusiness) throw new Error('No business selected');
      const { error } = await supabase.rpc('cancel_draft', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'purchase_bill',
        p_doc_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
      toast('Draft discarded', 'success');
      setDiscardTarget(null);
    },
    onError: (err: any) => { setDiscardTarget(null); toast(err.message || 'Failed to discard draft', 'error'); },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !cancelTarget) throw new Error('No bill selected');
      const { data: reversalId, error } = await supabase.rpc('cancel_purchase_bill', {
        p_bill_id: cancelTarget.id,
      });
      if (error) throw error;
      return reversalId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast('Bill cancelled and accounting reversed', 'success');
      setCancelTarget(null);
    },
    onError: (err: any) => toast(err.message || 'Failed to cancel bill', 'error'),
  });

  // Permanent bill delete. FK map to purchase_bills: purchase_bill_items.bill_id
  // CASCADE (auto-cleared; deleted explicitly anyway as defense in depth),
  // payments.bill_id SET NULL (no action needed), debit_notes.purchase_bill_id
  // RESTRICT (linked notes + their items deleted first). Posted bills carry
  // journal/stock postings with no FK back to the bill, so the
  // cancel_purchase_bill RPC posts the reversal first to keep ledger/stock
  // balanced; draft/cancelled bills skip it.
  const deleteBillMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness || !deleteTarget) throw new Error('No bill selected');
      const billId = deleteTarget.id;
      const biz = activeBusiness.id;
      if (['confirmed', 'partially_paid', 'paid'].includes(deleteTarget.status)) {
        const { error } = await supabase.rpc('cancel_purchase_bill', { p_bill_id: billId });
        if (error) throw error;
      }
      const { data: notes, error: notesError } = await supabase
        .from('debit_notes')
        .select('id')
        .eq('business_id', biz)
        .eq('purchase_bill_id', billId);
      if (notesError) throw notesError;
      const noteIds = ((notes ?? []) as { id: string }[]).map((n) => n.id);
      if (noteIds.length > 0) {
        const { error: itemsError } = await supabase.from('debit_note_items').delete().eq('business_id', biz).in('debit_note_id', noteIds);
        if (itemsError) throw itemsError;
        const { error: notesDelError } = await supabase.from('debit_notes').delete().eq('business_id', biz).in('id', noteIds);
        if (notesDelError) throw notesDelError;
      }
      const { error: billItemsError } = await supabase.from('purchase_bill_items').delete().eq('business_id', biz).eq('bill_id', billId);
      if (billItemsError) throw billItemsError;
      const { error } = await supabase.from('purchase_bills').delete().eq('id', billId);
      if (error) throw error;
    },
    onSuccess: () => {
      // Drop the row from the query cache immediately, then refetch.
      const id = deleteTarget?.id;
      if (id) {
        queryClient.setQueryData<(PurchaseBill & { supplier: { name: string } | null })[]>(
          ['purchase-bills', activeBusiness?.id],
          (old) => (old ? old.filter((b) => b.id !== id) : old),
        );
      }
      // A posted-bill reversal touches ledger/dashboard caches too.
      ['purchase-bills', 'dashboard-stats', 'accounts', 'journal-entries', 'trial-balance'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast('Purchase bill deleted successfully', 'success');
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      // Page convention keeps the modal open on error — surface the raw
      // message, routing ToastContext-sanitized signatures through 'warning'
      // (unsanitized) so the generic copy is unreachable.
      const raw = err?.message || 'Failed to delete purchase bill';
      toast(raw, sanitizeUserFacingError(raw) === raw ? 'error' : 'warning');
    },
  });

  return (
    <div>
      <PageHeader
        title="Purchase Bills"
        subtitle={`${filtered.length} bill${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/purchase-bills/new')}><Plus className="h-4 w-4" /> New Purchase</Button>}
      />

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[12rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input placeholder="Search purchase bills..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <div className="sm:ml-auto">
            <DataTableExportToolbar
              columns={[
                { key: 'number', label: 'Bill No.', getText: (b) => b.bill_number },
                { key: 'supplier', label: 'Supplier', getText: (b) => b.supplier?.name || '—' },
                { key: 'date', label: 'Date', getText: (b) => formatDate(b.bill_date) },
                { key: 'total', label: 'Total', getText: (b) => formatCurrency(b.grand_total, activeBusiness?.currency_symbol) },
                { key: 'balance', label: 'Balance', getText: (b) => formatCurrency(b.balance_amount, activeBusiness?.currency_symbol) },
                { key: 'status', label: 'Status', getText: (b) => b.status.replace('_', ' ') },
              ]}
              rows={filtered}
              filename="purchase-bills"
              title="Purchase Bills"
              storageKey="purchase-bills"
            />
          </div>
        </div>

        {isError ? (
          <ErrorState title="Unable to load purchase bills." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No purchase bills yet"
            description="Record your first purchase to track stock and expenses"
            action={<Button onClick={() => navigate('/app/purchase-bills/new')}><Plus className="h-4 w-4" /> New Purchase</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Bill No.</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Balance</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <p className="font-medium text-secondary-600 dark:text-secondary-300">{b.bill_number}</p>
                    </td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{b.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(b.bill_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100">
                      {formatCurrency(b.grand_total, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">
                      <span className={Number(b.balance_amount) > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}>
                        {formatCurrency(b.balance_amount, activeBusiness?.currency_symbol)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={statusVariant(b.status)}>{b.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" loading={printingId === b.id} onClick={() => printBill(b)} title="Download this bill as PDF">
                          <Printer className="h-3 w-3" /> PDF
                        </Button>
                        <button
                          onClick={() => setDeleteTarget(b)}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                          title="Delete bill"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {b.status === 'draft' && (
                          <>
                            <button
                              onClick={() => issueDraftMutation.mutate(b.id)}
                              className="p-1.5 rounded-lg text-secondary-400 hover:text-success-600 hover:bg-success-50 dark:hover:bg-success-900/30 transition-colors"
                              title="Confirm bill"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDiscardTarget(b)}
                              className="p-1.5 rounded-lg text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                              title="Discard draft"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {['confirmed', 'partially_paid', 'paid'].includes(b.status) && (
                        <button
                          onClick={() => setCancelTarget(b)}
                          className="p-1.5 rounded-lg text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                          title="Cancel bill"
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
        title="Cancel Purchase Bill?"
        message={`This will cancel bill ${cancelTarget?.bill_number || ''} and post a reversal journal entry. Existing payments and stock movements are preserved.`}
        confirmText="Cancel Bill"
        loading={cancelMutation.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteBillMutation.mutate()}
        title="Delete Purchase Bill?"
        message={`Are you sure you want to permanently delete bill ${deleteTarget?.bill_number || ''}? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleteBillMutation.isPending}
      />
    </div>
  );
}
