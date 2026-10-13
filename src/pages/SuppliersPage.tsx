import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast, sanitizeUserFacingError } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import { Truck, Plus, Pencil, Trash2, Mail } from 'lucide-react';
import { formatCurrency, formatDate, getInitials } from '@/lib/utils';
import { SendDialog } from '@/components/comms/SendDialog';
import type { Supplier } from '@/types/db';

export function SuppliersPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statementFor, setStatementFor] = useState<Supplier | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['suppliers', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as Supplier[], total: 0 };
      let q = supabase
        .from('suppliers')
        .select('*', { count: 'exact' })
        .eq('business_id', activeBusiness.id)
        .eq('status', 'active');
      if (list.debouncedSearch) {
        const p = likePattern(list.debouncedSearch);
        q = q.or(`name.ilike."${p}",phone.ilike."${p}",email.ilike."${p}",gstin.ilike."${p}"`);
      }
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(list.from, list.to);
      if (error) throw error;
      return { rows: (data || []) as Supplier[], total: count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const suppliers = data?.rows ?? [];
  const totalSuppliers = data?.total ?? 0;

  // Permanent-delete cascade. Migrations hold REFERENCES suppliers(id)
  // ON DELETE RESTRICT on purchase_bills / purchase_orders / debit_notes,
  // and payments reference the supplier polymorphically (party_type +
  // party_id). A bare delete throws FK 23503 whenever history exists, so
  // linked rows are removed first — draft/unfinalized rows outright,
  // finalized accounting rows only if RESTRICT still blocks (explicit user
  // order: the supplier must go). There is no deactivate path anymore.
  const isFkConstraintError = (message: string) =>
    /foreign[_\s-]?key|violates\s+foreign|\b23503\b|\bfk_/i.test(message || '');

  // Draft/unfinalized per the actual status columns in src/types/db.ts:
  // bills confirmed|partially_paid|paid, orders confirmed|received|converted,
  // notes issued|applied are finalized; everything else (draft|cancelled) goes
  // outright. Payments carry no status — always removed with the supplier.
  const isUnfinalizedStatus = (status: string) => status === 'draft' || status === 'cancelled';

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!activeBusiness) throw new Error('No active business');
      const biz = activeBusiness.id;
      // Probe + collect child ids (ids, not counts — line items key off parents).
      const [billsRes, ordersRes, notesRes, paymentsRes] = await Promise.all([
        supabase.from('purchase_bills').select('id,status').eq('business_id', biz).eq('supplier_id', id),
        supabase.from('purchase_orders').select('id,status').eq('business_id', biz).eq('supplier_id', id),
        supabase.from('debit_notes').select('id,status').eq('business_id', biz).eq('supplier_id', id),
        supabase.from('payments').select('id').eq('business_id', biz).eq('party_type', 'supplier').eq('party_id', id),
      ]);
      for (const r of [billsRes, ordersRes, notesRes, paymentsRes]) if (r.error) throw r.error;
      const bills = (billsRes.data ?? []) as { id: string; status: string }[];
      const orders = (ordersRes.data ?? []) as { id: string; status: string }[];
      const notes = (notesRes.data ?? []) as { id: string; status: string }[];
      const paymentIds = ((paymentsRes.data ?? []) as { id: string }[]).map((p) => p.id);

      const removed = {
        payments: 0,
        draftBills: 0, draftOrders: 0, draftNotes: 0,
        finalizedBills: 0, finalizedOrders: 0, finalizedNotes: 0,
      };

      const deleteByIds = async (table: string, column: string, ids: string[]) => {
        if (ids.length === 0) return;
        const { error } = await supabase.from(table).delete().eq('business_id', biz).in(column, ids);
        if (error) throw error;
      };

      let paymentsCleared = false;
      const clearScope = async (draftOnly: boolean) => {
        const pick = (rows: { id: string; status: string }[]) =>
          draftOnly ? rows.filter((r) => isUnfinalizedStatus(r.status)) : rows;
        const b = pick(bills);
        const o = pick(orders);
        const n = pick(notes);
        // Payments may point at bills — remove before bills. Line items point
        // at parents — remove before parents. Debit notes point at bills —
        // clear notes (and their items) before bills.
        if (!paymentsCleared) {
          await deleteByIds('payments', 'id', paymentIds);
          paymentsCleared = true;
          removed.payments = paymentIds.length;
        }
        await deleteByIds('debit_note_items', 'debit_note_id', n.map((r) => r.id));
        await deleteByIds('debit_notes', 'id', n.map((r) => r.id));
        await deleteByIds('purchase_bill_items', 'bill_id', b.map((r) => r.id));
        await deleteByIds('purchase_bills', 'id', b.map((r) => r.id));
        await deleteByIds('purchase_order_items', 'purchase_order_id', o.map((r) => r.id));
        await deleteByIds('purchase_orders', 'id', o.map((r) => r.id));
        if (draftOnly) {
          removed.draftBills = b.length;
          removed.draftOrders = o.length;
          removed.draftNotes = n.length;
        } else {
          removed.finalizedBills = bills.filter((r) => !isUnfinalizedStatus(r.status)).length;
          removed.finalizedOrders = orders.filter((r) => !isUnfinalizedStatus(r.status)).length;
          removed.finalizedNotes = notes.filter((r) => !isUnfinalizedStatus(r.status)).length;
        }
      };

      const hardDelete = async () => {
        const { error } = await supabase.from('suppliers').delete().eq('id', id);
        if (error) throw error;
      };

      const finalizedExists =
        bills.some((r) => !isUnfinalizedStatus(r.status)) ||
        orders.some((r) => !isUnfinalizedStatus(r.status)) ||
        notes.some((r) => !isUnfinalizedStatus(r.status));

      try {
        await clearScope(true);
        await hardDelete();
      } catch (err: any) {
        // RESTRICT blocked by finalized accounting rows → per explicit user
        // order those go too, then the supplier. Anything else (or nothing
        // finalized to blame) surfaces as an explicit raw error below.
        if (!finalizedExists || !isFkConstraintError(err?.message)) throw err;
        await clearScope(false);
        await hardDelete();
      }
      return removed;
    },
    onSuccess: (_removed, id) => {
      // Drop the row from local cache immediately, then refetch authoritative state.
      queryClient.setQueriesData<{ rows: Supplier[]; total: number }>(
        { queryKey: ['suppliers', activeBusiness?.id] },
        (old) => (old ? { rows: old.rows.filter((s) => s.id !== id), total: Math.max(0, old.total - 1) } : old),
      );
      queryClient.invalidateQueries({ queryKey: ['suppliers', activeBusiness?.id] });
      toast('Supplier permanently deleted successfully', 'success');
      setDeleteId(null);
    },
    onError: (err: any) => {
      const raw = err?.message || 'Failed to delete supplier';
      // 'error' toasts matching ToastContext RAW_ERROR_SIGNATURES are rewritten
      // to generic copy — route those through 'warning' (unsanitized) so the
      // explicit raw message always reaches the user verbatim.
      toast(raw, sanitizeUserFacingError(raw) === raw ? 'error' : 'warning');
    },
  });

  const openEdit = (s: Supplier) => {
    navigate('/app/suppliers/' + s.id + '/edit');
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={`${totalSuppliers} supplier${totalSuppliers !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/suppliers/new')}><Plus className="h-4 w-4" /> Add Supplier</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by name, phone, GSTIN..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        <div className="px-4 py-2 border-b border-secondary-200 dark:border-secondary-800 flex justify-end">
          <DataTableExportToolbar
            columns={[
              { key: 'name', label: 'Supplier', getText: (s) => s.name },
              { key: 'company', label: 'Company', getText: (s) => s.company_name || '—' },
              { key: 'phone', label: 'Phone', getText: (s) => s.phone || '—' },
              { key: 'email', label: 'Email', getText: (s) => s.email || '—' },
              { key: 'gstin', label: 'GSTIN', getText: (s) => s.gstin || '—' },
              { key: 'outstanding', label: 'Outstanding', getText: (s) => formatCurrency(s.current_balance, activeBusiness?.currency_symbol) },
              { key: 'purchases', label: 'Total Purchases', getText: (s) => formatCurrency(s.total_purchases, activeBusiness?.currency_symbol) },
              { key: 'status', label: 'Status', getText: (s) => s.status },
            ]}
            rows={suppliers}
            filename="suppliers"
            title="Suppliers"
            storageKey="suppliers"
          />
        </div>

        {isError ? (
          <ErrorState title="Unable to load suppliers." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            description="Add your first supplier to start recording purchases"
            action={<Button onClick={() => navigate('/app/suppliers/new')}><Plus className="h-4 w-4" /> Add Supplier</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">GSTIN</th>
                  <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Total Purchases</th>
                  <th className="text-center px-4 py-3 font-medium hidden xl:table-cell">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-300 flex items-center justify-center text-xs font-semibold shrink-0">
                          {getInitials(s.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-secondary-900 dark:text-secondary-100 truncate">{s.name}</p>
                          {s.company_name && <p className="text-xs text-secondary-400 truncate">{s.company_name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-secondary-600 dark:text-secondary-300">{s.phone || '—'}</p>
                      <p className="text-xs text-secondary-400">{s.email || ''}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-secondary-600 dark:text-secondary-300 font-mono text-xs">{s.gstin || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={Number(s.current_balance) > 0 ? 'text-error-600 dark:text-error-400 font-medium' : 'text-secondary-500'}>
                        {formatCurrency(s.current_balance, activeBusiness?.currency_symbol)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300 hidden sm:table-cell">
                      {formatCurrency(s.total_purchases, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                      <Badge variant={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(s)} className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setStatementFor(s)} title="Send account statement" className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(s.id)} className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
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
          from={list.from}
          total={totalSuppliers}
          isLoading={isLoading}
        />
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Supplier?"
        message="This will permanently remove the supplier. This action cannot be undone."
        confirmText="Delete"
        loading={deleteMutation.isPending}
      />

      <SendDialog
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        contextLabel={`Statement — ${statementFor?.name ?? ''}`}
        docType="statement"
        docNumber="STATEMENT"
        templateKey="statement_supplier"
        templateVariables={{
          supplier_name: statementFor?.name || '',
          business_name: activeBusiness?.name || '',
          period_start: formatDate(new Date(Date.now() - 90 * 86400000)),
          period_end: formatDate(new Date()),
          balance: formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Supplier statement from ${activeBusiness?.name || 'us'}`}
        defaultMessage={`Dear ${statementFor?.name || 'supplier'}, please find your account statement attached. Closing balance: ${formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol)}.`}
        recipients={[
          {
            label: statementFor?.company_name || statementFor?.name || 'Supplier on record',
            email: statementFor?.email,
            phone: statementFor?.phone,
          },
        ]}
        attachments={[
          {
            id: 'statement-csv',
            label: 'Account statement (CSV)',
            filename: `statement-${(statementFor?.name || 'supplier').replace(/\W+/g, '-').toLowerCase()}.csv`,
            build: async () => {
              if (!activeBusiness || !statementFor) throw new Error('Statement is not ready.');
              const { data, error } = await supabase.rpc('get_supplier_statement', {
                p_business_id: activeBusiness.id,
                p_supplier_id: statementFor.id,
                p_from_date: null,
                p_to_date: null,
              });
              if (error) throw new Error(error.message);
              const rows = (data || []) as { entry_date: string; description: string; doc_number: string | null; debit_amount: number; credit_amount: number; running_balance: number }[];
              const header = ['Date', 'Description', 'Doc No', 'Debit', 'Credit', 'Balance'];
              const lines = rows.map((r) =>
                [r.entry_date, `"${r.description.replace(/"/g, '""')}"`, r.doc_number || '', r.debit_amount, r.credit_amount, r.running_balance].join(',')
              );
              return new Blob([`\uFEFF${[header.join(','), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
            },
          },
        ]}
      />
    </div>
  );
}
