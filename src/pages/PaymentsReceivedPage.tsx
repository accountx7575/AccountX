import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import { usePagedList } from '@/hooks/usePagedList';
import { Banknote, Plus, Search, Send } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { SendDialog } from '@/components/comms/SendDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Payment } from '@/types/db';

export function PaymentsReceivedPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unapplied'>('all');
  const [sendTarget, setSendTarget] = useState<(Payment & { customer: { name: string; email: string | null; phone: string | null } | null; invoice: { invoice_number: string } | null }) | null>(null);

  const { data: payments, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments-received', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('payments').select('*, customer:customers(name,email,phone), invoice:sales_invoices(invoice_number)')
        .eq('business_id', activeBusiness.id).eq('type', 'received')
        .order('created_at', { ascending: false });
      return data as (Payment & { customer: { name: string; email: string | null; phone: string | null } | null; invoice: { invoice_number: string } | null })[];
    },
    enabled: !!activeBusiness,
  });

  const filtered = useMemo(() => {
    if (!payments) return [];
    return payments.filter((p) => {
      if (statusFilter === 'unapplied' && Math.round((p.amount - p.allocated_amount) * 100) <= 0) return false;
      return p.payment_number.toLowerCase().includes(list.search.toLowerCase()) ||
        (p.customer?.name || '').toLowerCase().includes(list.search.toLowerCase());
    });
  }, [payments, list.search, statusFilter]);

  const pageRows = filtered.slice(list.from, list.from + list.pageSize);

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
          <div className="overflow-x-auto scrollbar-thin">
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
                    <td className="px-4 py-3 font-medium text-primary-600 dark:text-primary-400">{p.payment_number}</td>
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
                      <Tooltip label="Send receipt to the customer">
                        <Button size="sm" variant="ghost" onClick={() => setSendTarget(p)}>
                          <Send className="h-3.5 w-3.5" /> Receipt
                        </Button>
                      </Tooltip>
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
