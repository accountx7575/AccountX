import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { FilePlus, Plus, Lock } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { calculateGstAmounts } from '@/lib/accounting';
import type { DebitNote } from '@/types/db';

type BillOptionRow = {
  id: string;
  bill_number: string;
  bill_date: string;
  place_of_supply: string | null;
  supplier_id: string;
  supplier: { name: string } | null;
};

type DraftLine = {
  purchase_bill_item_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  maxQuantity: number;
  rate: number;
  tax_rate: number;
};

const statusStyles: Record<string, string> = {
  draft: 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800 dark:text-secondary-300',
  issued: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
  applied: 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300',
  cancelled: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
};

export function DebitNotesPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const navigate = useNavigate();
  const list = usePagedList();
  const [confirmAction, setConfirmAction] = useState<{ kind: 'cancel' | 'apply'; note: DebitNote } | null>(null);
  const [refundMethod, setRefundMethod] = useState('bank');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['debit-notes', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as (DebitNote & { supplier: { name: string } | null; bill: { bill_number: string } | null })[], total: 0 };
      const pattern = list.debouncedSearch ? likePattern(list.debouncedSearch) : null;
      const run = async (withJoin: boolean) => {
        let q = supabase.from('debit_notes')
          .select((withJoin ? '*, supplier:suppliers(name), bill:purchase_bills(bill_number)' : '*') as string, { count: 'exact' })
          .eq('business_id', activeBusiness.id);
        if (pattern) {
          q = withJoin
            ? q.or(`debit_note_number.ilike."${pattern}",supplier.name.ilike."${pattern}",bill.bill_number.ilike."${pattern}"`)
            : q.or(`debit_note_number.ilike."${pattern}"`);
        }
        return q.order('created_at', { ascending: false }).range(list.from, list.to);
      };
      let res = await run(true);
      if (res.error) res = await run(false);
      if (res.error) return { rows: [] as unknown as (DebitNote & { supplier: { name: string } | null; bill: { bill_number: string } | null })[], total: 0 };
      return { rows: (res.data || []) as unknown as (DebitNote & { supplier: { name: string } | null; bill: { bill_number: string } | null })[], total: res.count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const notes = data?.rows ?? [];
  const totalNotes = data?.total ?? 0;

  const invalidateAll = () => {
    ['debit-notes', 'dashboard-stats', 'accounts', 'journal-entries', 'trial-balance', 'products', 'stock-movements'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
    );
    queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
  };

  const actionMutation = useMutation({
    mutationFn: async ({ kind, note }: { kind: 'issue' | 'cancel' | 'apply'; note: DebitNote }) => {
      if (!activeBusiness) throw new Error('No active business');
      if (kind === 'issue') {
        const { error } = await supabase.rpc('issue_debit_note', { p_business_id: activeBusiness.id, p_debit_note_id: note.id });
        if (error) throw error;
      } else if (kind === 'cancel') {
        const { error } = await supabase.rpc('cancel_debit_note', { p_business_id: activeBusiness.id, p_debit_note_id: note.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('apply_debit_note', { p_business_id: activeBusiness.id, p_debit_note_id: note.id, p_refund_method: refundMethod });
        if (error) throw error;
      }
      return kind;
    },
    onSuccess: (kind) => {
      invalidateAll();
      toast(kind === 'issue' ? 'Debit note issued — journal posted'
        : kind === 'apply' ? 'Debit note applied — any excess collected via payments'
        : 'Debit note cancelled', 'success');
      setConfirmAction(null);
    },
    onError: (err: any) => { setConfirmAction(null); toast(err.message || 'Action failed', 'error'); },
  });


  return (
    <div>
      <PageHeader title="Debit Notes" subtitle={`${totalNotes} note${totalNotes !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/debit-notes/new')}><Plus className="h-4 w-4" /> New Debit Note</Button>} />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number, supplier, bill..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {isError ? (
          <ErrorState title="Unable to load debit notes." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : notes.length === 0 ? (
          <EmptyState icon={FilePlus} title="No debit notes yet" description="Create one from a live purchase bill"
            action={<Button onClick={() => navigate('/app/debit-notes/new')}><Plus className="h-4 w-4" /> New Debit Note</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Note No.</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Against Bill</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-500">{n.debit_note_number}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(n.date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-900 dark:text-secondary-100">{n.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-500">{n.bill?.bill_number || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium figure">{formatCurrency(n.grand_total, activeBusiness?.currency_symbol)}</td>
                    <td className="px-4 py-3"><span className={`badge ${statusStyles[n.status]}`}>{n.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5" title={n.status === 'applied' ? 'Applied notes are immutable — refunds already flowed' : undefined}>
                        {n.status === 'draft' && (
                          <>
                            <Button size="sm" onClick={() => actionMutation.mutate({ kind: 'issue', note: n })} loading={actionMutation.isPending}>Issue</Button>
                            <Button size="sm" variant="secondary" onClick={() => setConfirmAction({ kind: 'cancel', note: n })}>Cancel</Button>
                          </>
                        )}
                        {n.status === 'issued' && (
                          <>
                            <Button size="sm" onClick={() => setConfirmAction({ kind: 'apply', note: n })}>Apply</Button>
                            <Button size="sm" variant="secondary" onClick={() => setConfirmAction({ kind: 'cancel', note: n })}>Cancel</Button>
                          </>
                        )}
                        {(n.status === 'applied' || n.status === 'cancelled') && (
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
          total={totalNotes}
          isLoading={isLoading}
        />
      </div>

      <Drawer open={!!confirmAction && confirmAction.kind === 'apply'} onClose={() => setConfirmAction(null)} title="Apply Debit Note"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="secondary" onClick={() => setConfirmAction(null)} className="flex-1">Back</Button>
            <Button onClick={() => confirmAction && actionMutation.mutate({ kind: 'apply', note: confirmAction.note })} loading={actionMutation.isPending} className="flex-1">Apply</Button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-sm text-secondary-600 dark:text-secondary-300">
            Applies {confirmAction ? formatCurrency(confirmAction.note.grand_total, activeBusiness?.currency_symbol) : ''} against the parent
            bill's outstanding balance. Any excess beyond outstanding is collected from the supplier through an automatic refund-received entry.
          </p>
          <FormField label="Refund Method (for any excess)">
            <select className="input" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="cheque">Cheque</option>
            </select>
          </FormField>
          <p className="text-xs text-secondary-400">Applying is final — applied notes cannot be cancelled or edited.</p>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!confirmAction && confirmAction.kind === 'cancel'}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => confirmAction && actionMutation.mutate({ kind: 'cancel', note: confirmAction.note })}
        title="Cancel debit note?"
        message={confirmAction?.note.status === 'issued'
          ? 'Issuing was already journaled — cancelling posts a mirror-cancellation entry and reverses any stock movements.'
          : 'The draft will be marked cancelled.'}
        confirmText="Cancel Note"
        loading={actionMutation.isPending}
      />
    </div>
  );
}
