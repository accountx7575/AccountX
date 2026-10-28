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
import { usePagedList } from '@/hooks/usePagedList';
import { Banknote, Plus, Search, Send, Pencil, Trash2, Printer, Eye } from 'lucide-react';
import { formatCurrency, formatDate, todayDateString, roundTo2, isUuid } from '@/lib/utils';
import { printPaymentReceipt, type PaymentReceiptParty } from '@/lib/receiptPrint';
import { SendDialog } from '@/components/comms/SendDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Payment } from '@/types/db';

export function PaymentsReceivedPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unapplied'>('all');
  const [sendTarget, setSendTarget] = useState<(Payment & { customer: PaymentReceiptParty | null; invoice: { invoice_number: string } | null }) | null>(null);

  const { data: payments, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments-received', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness?.id) return [];

      let rawRows: any[] = [];

      // Primary source table: 'payments'
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('type', 'received')
        .order('created_at', { ascending: false });

      if (paymentsError) {
        // Defensive fallback: check if 'payments_received' table or view exists
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('payments')
          .select('*')
          .eq('business_id', activeBusiness.id)
          .order('created_at', { ascending: false });

        if (fallbackError) {
          console.error('[PaymentsReceivedPage] failed to fetch payments:', paymentsError);
          throw paymentsError;
        }
        rawRows = fallbackData || [];
      } else {
        rawRows = paymentsData || [];
      }

      // Collect customer IDs and invoice IDs
      const customerIds = Array.from(
        new Set(
          rawRows
            .map((p) => p.party_id || p.customer_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      const invoiceIds = Array.from(
        new Set(
          rawRows
            .map((p) => p.invoice_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      // Fetch customers and invoices in parallel without join failure risks
      const [customersRes, invoicesRes] = await Promise.all([
        customerIds.length > 0
          ? supabase
              .from('customers')
              .select('id, name, email, phone, address, city, state, pincode, gstin, pan, aadhaar, company_name')
              .in('id', customerIds)
          : Promise.resolve({ data: [] }),
        invoiceIds.length > 0
          ? supabase
              .from('sales_invoices')
              .select('id, invoice_number')
              .in('id', invoiceIds)
          : Promise.resolve({ data: [] }),
      ]);

      const customerMap = new Map((customersRes.data || []).map((c: any) => [c.id, c]));
      const invoiceMap = new Map((invoicesRes.data || []).map((i: any) => [i.id, i]));

      return rawRows.map((p) => {
        const custId = p.party_id || p.customer_id;
        const customer = custId ? customerMap.get(custId) || null : null;
        const invoice = p.invoice_id ? invoiceMap.get(p.invoice_id) || null : null;

        return {
          ...p,
          date: p.date || p.payment_date || p.created_at?.split('T')[0] || todayDateString(),
          amount: Number(p.amount) || 0,
          allocated_amount: Number(p.allocated_amount) || 0,
          payment_number: p.payment_number || p.number || '',
          payment_method: p.payment_method || p.method || 'cash',
          customer,
          invoice,
        };
      }) as (Payment & {
        customer: PaymentReceiptParty | null;
        invoice: { invoice_number: string } | null;
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
        (p.customer?.name || '').toLowerCase().includes(searchLower) ||
        (p.reference || '').toLowerCase().includes(searchLower)
      );
    });
  }, [payments, list.search, statusFilter]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);

  const deleteMutation = useMutation({
    mutationFn: async (payment: Payment) => {
      if (!activeBusiness?.id) throw new Error('No active business');

      // 1. Revert invoice paid/balance amounts if allocated
      if (payment.invoice_id && payment.allocated_amount > 0 && isUuid(payment.invoice_id)) {
        try {
          const { data: inv } = await supabase
            .from('sales_invoices')
            .select('paid_amount, balance_amount, grand_total, status')
            .eq('id', payment.invoice_id)
            .eq('business_id', activeBusiness.id)
            .maybeSingle();

          if (inv) {
            const currentPaid = Number(inv.paid_amount) || 0;
            const grandTotal = Number(inv.grand_total) || 0;
            const newPaid = roundTo2(Math.max(0, currentPaid - Number(payment.allocated_amount)));
            const newBalance = roundTo2(Math.min(grandTotal, grandTotal - newPaid));
            const newPayStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
            const newStatus = newPayStatus === 'paid' ? 'paid' : (newPaid > 0 ? 'partially_paid' : 'issued');

            await supabase
              .from('sales_invoices')
              .update({
                paid_amount: newPaid,
                balance_amount: newBalance,
                payment_status: newPayStatus,
                status: newStatus,
              })
              .eq('id', payment.invoice_id)
              .eq('business_id', activeBusiness.id);
          }
        } catch (invErr) {
          console.warn('Revert invoice balance warning:', invErr);
        }
      }

      // 2. Revert customer balance & total_paid
      const custId = payment.party_id || (payment as any).customer_id;
      if (custId && payment.amount > 0 && isUuid(custId)) {
        try {
          const [custRes, invRes, payRes] = await Promise.all([
            supabase
              .from('customers')
              .select('opening_balance')
              .eq('id', custId)
              .eq('business_id', activeBusiness.id)
              .maybeSingle(),
            supabase
              .from('sales_invoices')
              .select('grand_total')
              .eq('customer_id', custId)
              .eq('business_id', activeBusiness.id)
              .in('status', ['issued', 'partially_paid', 'paid']),
            supabase
              .from('payments')
              .select('amount')
              .eq('party_id', custId)
              .eq('party_type', 'customer')
              .eq('business_id', activeBusiness.id)
              .eq('type', 'received')
              .neq('id', payment.id),
          ]);

          const openingBal = Number(custRes.data?.opening_balance) || 0;
          const totalSales = (invRes.data || []).reduce((acc, r) => acc + (Number(r.grand_total) || 0), 0);
          const totalPaid = (payRes.data || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
          const totalDebit = roundTo2(openingBal + totalSales);
          const newBal = totalDebit <= 0 ? 0 : Math.max(0, roundTo2(totalDebit - totalPaid));

          await supabase
            .from('customers')
            .update({
              current_balance: newBal,
              total_sales: roundTo2(totalSales),
              total_paid: roundTo2(totalPaid),
            })
            .eq('id', custId)
            .eq('business_id', activeBusiness.id);
        } catch (custErr) {
          console.warn('Revert customer balance warning:', custErr);
        }
      }

      // 3. Delete matching journal entries directly (journal_entry_lines cascades automatically via entry_id FK)
      try {
        if (isUuid(payment.id)) {
          await supabase
            .from('journal_entries')
            .delete()
            .eq('business_id', activeBusiness.id)
            .eq('reference_type', 'payment_received')
            .eq('reference_id', payment.id);
        }

        if (payment.payment_number) {
          await supabase
            .from('journal_entries')
            .delete()
            .eq('business_id', activeBusiness.id)
            .ilike('narration', `%${payment.payment_number}%`);
        }
      } catch (jeErr) {
        console.warn('Journal entries cleanup warning:', jeErr);
      }

      // 4. Delete payment from primary payments table
      const { error } = await supabase
        .from('payments')
        .delete()
        .eq('id', payment.id)
        .eq('business_id', activeBusiness.id);

      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ledger'] });
      await queryClient.invalidateQueries({ queryKey: ['journal-lines-ledger'] });
      await queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      await queryClient.invalidateQueries({ queryKey: ['payments-received'] });
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['sales-invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      await queryClient.invalidateQueries({ queryKey: ['cashflow-series'] });
      await queryClient.invalidateQueries({ queryKey: ['liquid-cash'] });
      await queryClient.invalidateQueries({ queryKey: ['receivables'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      await queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
      toast('Payment deleted successfully', 'success');
    },
    onError: (err: any) => {
      toast(err?.message || 'Failed to delete payment', 'error');
    },
  });

  const handleDelete = (payment: Payment) => {
    if (window.confirm(`Are you sure you want to delete payment ${payment.payment_number}?`)) {
      deleteMutation.mutate(payment);
    }
  };

  return (
    <div>
      <PageHeader
        title="Payment Received"
        subtitle={`${filtered.length} payment${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/payments-received/new')}><Plus className="h-4 w-4" /> Receive Payment</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number, customer, or reference..."
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
              { key: 'number', label: 'Receipt No.', getText: (p) => p.payment_number },
              { key: 'customer', label: 'Customer', getText: (p) => p.customer?.name || '—' },
              { key: 'date', label: 'Date', getText: (p) => formatDate(p.date) },
              { key: 'method', label: 'Method', getText: (p) => p.payment_method },
              { key: 'amount', label: 'Amount', getText: (p) => formatCurrency(p.amount, activeBusiness?.currency_symbol) },
              { key: 'unapplied', label: 'Unapplied', getText: (p) => (Math.round((p.amount - p.allocated_amount) * 100) > 0 ? formatCurrency(Math.round((p.amount - p.allocated_amount) * 100) / 100, activeBusiness?.currency_symbol) : '—') },
            ]}
            rows={pageRows}
            filename="payments-received"
            title="Payments Received"
            storageKey="payments-received"
          />
        </ListToolbar>

        {isError ? (
          <ErrorState title="Unable to load payments received." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Banknote} title="No payments received yet" description="Record payments from your customers" action={<Button onClick={() => navigate('/app/payments-received/new')}><Plus className="h-4 w-4" /> Receive Payment</Button>} />
        ) : (
          <div className="w-full">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Receipt No.</th>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Method</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-primary-600 dark:text-primary-400">
                      <button
                        type="button"
                        onClick={() => navigate(`/app/payments-received/${p.id}`)}
                        className="hover:underline text-left font-medium text-primary-600 dark:text-primary-400 focus:outline-none"
                      >
                        {p.payment_number}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{p.customer?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-600 dark:text-secondary-300 uppercase text-xs">{p.payment_method}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="tabular-nums font-medium text-success-600 dark:text-success-400">{formatCurrency(p.amount, activeBusiness?.currency_symbol)}</div>
                      {Math.round((p.amount - p.allocated_amount) * 100) > 0 && (
                        <span className="badge bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 mt-0.5">
                          Unapplied {formatCurrency(Math.round((p.amount - p.allocated_amount) * 100) / 100, activeBusiness?.currency_symbol)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip label="Send receipt to the customer">
                          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setSendTarget(p)}>
                            <Send className="h-3.5 w-3.5 sm:mr-1" />
                            <span className="hidden sm:inline">Receipt</span>
                          </Button>
                        </Tooltip>
                        <Tooltip label="View receipt">
                          <button
                            onClick={() => navigate(`/app/payments-received/${p.id}`)}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="View receipt"
                            aria-label="View receipt"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Print Receipt">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              printPaymentReceipt(p, activeBusiness);
                            }}
                            className="p-1.5 rounded-lg text-secondary-500 dark:text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                            title="Print Receipt"
                            aria-label="Print Receipt"
                          >
                            <Printer className="h-4 w-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Edit payment">
                          <button
                            onClick={() => navigate(`/app/payments-received/${p.id}/edit`)}
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

      <SendDialog
        open={!!sendTarget}
        onClose={() => setSendTarget(null)}
        contextLabel={`Receipt ${sendTarget?.payment_number ?? ''}`}
        docType="payment_receipt"
        docId={sendTarget?.id}
        docNumber={sendTarget?.payment_number}
        templateKey="payment_received"
        templateVariables={{
          customer_name: sendTarget?.customer?.name || '',
          invoice_number: sendTarget?.invoice?.invoice_number || '—',
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Payment received — thank you (${sendTarget?.payment_number ?? ''})`}
        defaultMessage={`Dear ${sendTarget?.customer?.name || 'customer'}, we have received your payment of ${formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol)} (receipt ${sendTarget?.payment_number ?? ''}). Thank you for your business.`}
        recipients={[
          {
            label: sendTarget?.customer?.name || 'Customer on record',
            email: sendTarget?.customer?.email,
            phone: sendTarget?.customer?.phone,
          },
        ]}
      />
    </div>
  );
}
