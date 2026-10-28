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
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePagedList } from '@/hooks/usePagedList';
import { CreditCard, Plus, Search, Send, Eye, Pencil, Trash2, Printer } from 'lucide-react';
import { formatCurrency, formatDate, todayDateString, roundTo2, isUuid } from '@/lib/utils';
import { printPaymentVoucher } from '@/lib/receiptPrint';
import { SendDialog } from '@/components/comms/SendDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Payment } from '@/types/db';

export function PaymentsMadePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unapplied'>('all');
  const [confirmDelete, setConfirmDelete] = useState<Payment | null>(null);
  const [sendTarget, setSendTarget] = useState<(Payment & { supplier: { name: string; email: string | null; phone: string | null } | null }) | null>(null);

  const { data: payments, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments-made', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness?.id) return [];

      let rawRows: any[] = [];

      // Primary source table: 'payments'
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('type', 'made')
        .order('created_at', { ascending: false });

      if (paymentsError) {
        // Defensive fallback: check if 'payments_made' table or view exists
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('payments_made')
          .select('*')
          .eq('business_id', activeBusiness.id)
          .order('created_at', { ascending: false });

        if (fallbackError) {
          console.error('[PaymentsMadePage] failed to fetch payments:', paymentsError);
          throw paymentsError;
        }
        rawRows = fallbackData || [];
      } else {
        rawRows = paymentsData || [];
      }

      // Collect supplier IDs and bill IDs
      const supplierIds = Array.from(
        new Set(
          rawRows
            .map((p) => p.party_id || p.supplier_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      const billIds = Array.from(
        new Set(
          rawRows
            .map((p) => p.bill_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      // Fetch suppliers and bills in parallel without join failure risks
      const [suppliersRes, billsRes] = await Promise.all([
        supplierIds.length > 0
          ? supabase
              .from('suppliers')
              .select('id, name, email, phone, address, city, state, pincode, gstin, pan, company_name')
              .in('id', supplierIds)
          : Promise.resolve({ data: [] }),
        billIds.length > 0
          ? supabase
              .from('purchase_bills')
              .select('id, bill_number')
              .in('id', billIds)
          : Promise.resolve({ data: [] }),
      ]);

      const supplierMap = new Map((suppliersRes.data || []).map((s: any) => [s.id, s]));
      const billMap = new Map((billsRes.data || []).map((b: any) => [b.id, b]));

      return rawRows.map((p) => {
        const suppId = p.party_id || p.supplier_id;
        const supplier = suppId ? supplierMap.get(suppId) || null : null;
        const bill = p.bill_id ? billMap.get(p.bill_id) || null : null;

        return {
          ...p,
          date: p.date || p.payment_date || p.created_at?.split('T')[0] || todayDateString(),
          amount: Number(p.amount) || 0,
          allocated_amount: Number(p.allocated_amount) || 0,
          payment_number: p.payment_number || p.number || '',
          payment_method: p.payment_method || p.method || 'cash',
          supplier,
          bill,
        };
      }) as (Payment & {
        supplier: { name: string; email: string | null; phone: string | null; [key: string]: any } | null;
        bill?: { bill_number: string } | null;
      })[];
    },
    enabled: !!activeBusiness?.id,
  });

  const filtered = useMemo(() => {
    if (!payments) return [];
    return payments.filter((p) => {
      if (statusFilter === 'unapplied' && Math.round(((p.amount || 0) - (p.allocated_amount || 0)) * 100) <= 0) return false;
      const searchLower = (list.search || '').toLowerCase();
      return (
        (p.payment_number || '').toLowerCase().includes(searchLower) ||
        (p.supplier?.name || '').toLowerCase().includes(searchLower) ||
        (p.reference || '').toLowerCase().includes(searchLower)
      );
    });
  }, [payments, list.search, statusFilter]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);

  const deleteMutation = useMutation({
    mutationFn: async (payment: Payment) => {
      if (!activeBusiness?.id) throw new Error('No active business');

      // 1. Revert bill allocation if allocated
      const allocAmt = Number(payment.allocated_amount) || Number(payment.amount) || 0;
      if (payment.bill_id && allocAmt > 0 && isUuid(payment.bill_id)) {
        try {
          const { data: bill } = await supabase
            .from('purchase_bills')
            .select('paid_amount, balance_amount, grand_total, status')
            .eq('id', payment.bill_id)
            .eq('business_id', activeBusiness.id)
            .maybeSingle();

          if (bill) {
            const currentPaid = Number(bill.paid_amount) || 0;
            const grandTotal = Number(bill.grand_total) || 0;
            const newPaid = roundTo2(Math.max(0, currentPaid - allocAmt));
            const newBalance = roundTo2(Math.min(grandTotal, grandTotal - newPaid));
            const newPayStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
            const newStatus = newPayStatus === 'paid' ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'confirmed');

            await supabase
              .from('purchase_bills')
              .update({
                paid_amount: newPaid,
                balance_amount: newBalance,
                payment_status: newPayStatus,
                status: newStatus,
              })
              .eq('id', payment.bill_id)
              .eq('business_id', activeBusiness.id);
          }
        } catch (billErr) {
          console.warn('Revert purchase bill balance warning:', billErr);
        }
      }

      // 2. Revert supplier balance & total_paid
      const suppId = payment.party_id || (payment as any).supplier_id;
      if (suppId && payment.amount > 0 && isUuid(suppId)) {
        try {
          const [suppRes, billsRes, payRes] = await Promise.all([
            supabase
              .from('suppliers')
              .select('opening_balance')
              .eq('id', suppId)
              .eq('business_id', activeBusiness.id)
              .maybeSingle(),
            supabase
              .from('purchase_bills')
              .select('grand_total')
              .eq('supplier_id', suppId)
              .eq('business_id', activeBusiness.id)
              .in('status', ['confirmed', 'partially_paid', 'paid']),
            supabase
              .from('payments')
              .select('amount')
              .eq('party_id', suppId)
              .eq('party_type', 'supplier')
              .eq('business_id', activeBusiness.id)
              .eq('type', 'made')
              .neq('id', payment.id),
          ]);

          const openingBal = Number(suppRes.data?.opening_balance) || 0;
          const totalPurchases = (billsRes.data || []).reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0);
          const totalPaid = (payRes.data || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
          const totalPayable = roundTo2(openingBal + totalPurchases);
          const newBal = totalPayable <= 0 ? 0 : Math.max(0, roundTo2(totalPayable - totalPaid));

          await supabase
            .from('suppliers')
            .update({
              current_balance: newBal,
              total_purchases: roundTo2(totalPurchases),
              total_paid: roundTo2(totalPaid),
            })
            .eq('id', suppId)
            .eq('business_id', activeBusiness.id);
        } catch (suppErr) {
          console.warn('Revert supplier balance warning:', suppErr);
        }
      }

      // 3. Delete matching journal entries & lines
      try {
        if (isUuid(payment.id)) {
          const { data: jeList } = await supabase
            .from('journal_entries')
            .select('id')
            .eq('business_id', activeBusiness.id)
            .eq('reference_type', 'payment_made')
            .eq('reference_id', payment.id);

          if (jeList && jeList.length > 0) {
            const jeIds = jeList.map((j) => j.id);
            await supabase.from('journal_entry_lines').delete().in('entry_id', jeIds);
          }

          await supabase
            .from('journal_entries')
            .delete()
            .eq('business_id', activeBusiness.id)
            .eq('reference_type', 'payment_made')
            .eq('reference_id', payment.id);
        }

        if (payment.payment_number) {
          const { data: jeListByNarration } = await supabase
            .from('journal_entries')
            .select('id')
            .eq('business_id', activeBusiness.id)
            .ilike('narration', `%${payment.payment_number}%`);

          if (jeListByNarration && jeListByNarration.length > 0) {
            const jeIds = jeListByNarration.map((j) => j.id);
            await supabase.from('journal_entry_lines').delete().in('entry_id', jeIds);
          }

          await supabase
            .from('journal_entries')
            .delete()
            .eq('business_id', activeBusiness.id)
            .ilike('narration', `%${payment.payment_number}%`);
        }
      } catch (jeErr) {
        console.warn('Journal entries cleanup warning:', jeErr);
      }

      // 4. Delete payment from primary payments table and fallback
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', payment.id)
        .eq('business_id', activeBusiness.id);

      if (error) {
        try {
          await supabase.from('payments_made').delete().eq('id', payment.id).eq('business_id', activeBusiness.id);
        } catch {
          throw error;
        }
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ledger'] });
      await queryClient.invalidateQueries({ queryKey: ['journal-lines-ledger'] });
      await queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      await queryClient.invalidateQueries({ queryKey: ['payments-made'] });
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({ queryKey: ['purchase-bills'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['cashflow-series'] });
      await queryClient.invalidateQueries({ queryKey: ['liquid-cash'] });
      await queryClient.invalidateQueries({ queryKey: ['payables'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      setConfirmDelete(null);
      toast('Payment deleted successfully', 'success');
    },
    onError: (err: any) => {
      setConfirmDelete(null);
      toast(err?.message || 'Failed to delete payment', 'error');
    },
  });

  const handleDelete = (payment: Payment) => {
    setConfirmDelete(payment);
  };

  return (
    <div>
      <PageHeader
        title="Payment Made"
        subtitle={`${filtered.length} payment${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/payments-made/new')}><Plus className="h-4 w-4" /> Make Payment</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number, supplier, or reference..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
          pageSizes={[10, 25, 50, 100]}
          leftAddon={(
            <div className="max-w-[15rem] min-w-[9.5rem]">
              <select
                className="input h-9 py-0 leading-none text-sm cursor-pointer"
                aria-label="Payment status filter"
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as 'all' | 'unapplied'); list.setPage(1); }}
              >
                <option value="all">All Payments</option>
                <option value="unapplied">Unapplied</option>
              </select>
            </div>
          )}
        >
          <DataTableExportToolbar
            columns={[
              { key: 'number', label: 'Payment No.', getText: (p) => p.payment_number },
              { key: 'supplier', label: 'Supplier', getText: (p) => p.supplier?.name || '—' },
              { key: 'date', label: 'Date', getText: (p) => formatDate(p.date) },
              { key: 'method', label: 'Method', getText: (p) => p.payment_method },
              { key: 'amount', label: 'Amount', getText: (p) => formatCurrency(p.amount, activeBusiness?.currency_symbol) },
              { key: 'unapplied', label: 'Unapplied', getText: (p) => (Math.round((p.amount - p.allocated_amount) * 100) > 0 ? formatCurrency(Math.round((p.amount - p.allocated_amount) * 100) / 100, activeBusiness?.currency_symbol) : '—') },
            ]}
            rows={pageRows}
            filename="payment_made"
            title="Payments Made"
            storageKey="payment_made"
          />
        </ListToolbar>
        {isError ? (
          <ErrorState title="Unable to load payments made." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={CreditCard} title="No payments made yet" description="Record payments to your suppliers" action={<Button onClick={() => navigate('/app/payments-made/new')}><Plus className="h-4 w-4" /> Make Payment</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Payment No.</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Method</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium">
                      <button
                        onClick={() => navigate(`/app/payments-made/${p.id}`)}
                        className="hover:underline text-left font-medium text-error-600 dark:text-error-400 focus:outline-none"
                      >
                        {p.payment_number}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{p.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-600 dark:text-secondary-300 uppercase text-xs">{p.payment_method}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="tabular-nums font-medium text-error-600 dark:text-error-400">{formatCurrency(p.amount, activeBusiness?.currency_symbol)}</div>
                      {Math.round((p.amount - p.allocated_amount) * 100) > 0 && (
                        <span className="badge bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 mt-0.5">
                          Unapplied {formatCurrency(Math.round((p.amount - p.allocated_amount) * 100) / 100, activeBusiness?.currency_symbol)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip label="Send payment advice to the supplier">
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setSendTarget(p)}>
                            <Send className="h-3.5 w-3.5 sm:mr-1" />
                            <span className="hidden sm:inline">Advice</span>
                          </Button>
                        </Tooltip>
                        <Tooltip label="View payment">
                          <button
                            onClick={() => navigate(`/app/payments-made/${p.id}`)}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="View payment"
                            aria-label="View payment"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Print voucher">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              printPaymentVoucher(p, activeBusiness);
                            }}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="Print voucher"
                            aria-label="Print voucher"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Edit payment">
                          <button
                            onClick={() => navigate(`/app/payments-made/${p.id}/edit`)}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="Edit payment"
                            aria-label="Edit payment"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete payment">
                          <button
                            onClick={() => handleDelete(p)}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-colors disabled:opacity-50"
                            title="Delete payment"
                            aria-label="Delete payment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Tooltip>
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
        />
      </div>

      {/* Confirmation Dialog for Delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
        title="Delete Payment"
        message={`Are you sure you want to delete Payment ${confirmDelete?.payment_number || ''}? This will reverse ledger entries and restore supplier balance.`}
        confirmText="Delete"
        danger={true}
        loading={deleteMutation.isPending}
      />

      {/* Supplier-side payment advice */}
      <SendDialog
        open={!!sendTarget}
        onClose={() => setSendTarget(null)}
        contextLabel={`Payment ${sendTarget?.payment_number ?? ''}`}
        docType="payment_made"
        docId={sendTarget?.id}
        docNumber={sendTarget?.payment_number}
        templateKey="payment_made"
        templateVariables={{
          supplier_name: sendTarget?.supplier?.name || '',
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Payment sent — ${sendTarget?.payment_number ?? ''}`}
        defaultMessage={`Dear ${sendTarget?.supplier?.name || 'supplier'}, this is to confirm we have sent a payment of ${formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol)} (ref ${sendTarget?.payment_number ?? ''}). Thank you for your partnership.`}
        recipients={[
          {
            label: sendTarget?.supplier?.name || 'Supplier on record',
            email: sendTarget?.supplier?.email,
            phone: sendTarget?.supplier?.phone,
          },
        ]}
      />
    </div>
  );
}
