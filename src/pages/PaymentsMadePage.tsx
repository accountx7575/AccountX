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
import { CreditCard, Plus, Search, Send } from 'lucide-react';
import { formatCurrency, formatDate, todayDateString } from '@/lib/utils';
import { SendDialog } from '@/components/comms/SendDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Payment } from '@/types/db';

export function PaymentsMadePage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const list = usePagedList();
  const [statusFilter, setStatusFilter] = useState<'all' | 'unapplied'>('all');
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
              .select('id, name, email, phone')
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
        supplier: { name: string; email: string | null; phone: string | null } | null;
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
  return (
    <div>
      <PageHeader title="Payment Made" subtitle={`${filtered.length} payment${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/payments-made/new')}><Plus className="h-4 w-4" /> Make Payment</Button>} />

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
                    <td className="px-4 py-3 font-medium text-error-600 dark:text-error-400">{p.payment_number}</td>
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
                      <Tooltip label="Send payment advice to the supplier">
                        <Button size="sm" variant="ghost" onClick={() => setSendTarget(p)}>
                          <Send className="h-3.5 w-3.5" /> Advice
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

      {/* Supplier-side payment advice. doc_type 'payment_made' + seeded
          templates are LIVE (059 Part D: CHECK widened, email+in_app seeds
          using exactly these variables). defaultSubject/defaultMessage stay
          as the safety net if the template fetch misses or fails - the
          dialog prefers the stored template when one resolves. */}
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
