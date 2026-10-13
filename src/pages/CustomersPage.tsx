import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { DataTableExportToolbar } from '@/components/ui/DataTableExportToolbar';
import { Users, Plus, Pencil, Trash2, Mail } from 'lucide-react';
import { formatCurrency, formatDate, getInitials } from '@/lib/utils';
import { SendDialog } from '@/components/comms/SendDialog';
import type { Customer } from '@/types/db';

export function CustomersPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [statementFor, setStatementFor] = useState<Customer | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['customers', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as Customer[], total: 0 };
      let q = supabase
        .from('customers')
        .select('*', { count: 'exact' })
        .eq('business_id', activeBusiness.id);
      if (list.debouncedSearch) {
        const p = likePattern(list.debouncedSearch);
        q = q.or(`name.ilike."${p}",phone.ilike."${p}",email.ilike."${p}",gstin.ilike."${p}"`);
      }
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(list.from, list.to);
      if (error) throw error;
      return { rows: (data || []) as Customer[], total: count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const customers = data?.rows ?? [];
  const totalCustomers = data?.total ?? 0;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers', activeBusiness?.id] });
      toast('Customer deleted', 'success');
      setDeleteId(null);
    },
    onError: (err: any) => toast(err.message || 'Failed to delete customer', 'error'),
  });

  const openEdit = (c: Customer) => {
    navigate('/app/customers/' + c.id + '/edit');
  };

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${totalCustomers} customer${totalCustomers !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/customers/new')}><Plus className="h-4 w-4" /> Add Customer</Button>}
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
              { key: 'name', label: 'Customer', getText: (c) => c.name },
              { key: 'company', label: 'Company', getText: (c) => c.company_name || '—' },
              { key: 'phone', label: 'Phone', getText: (c) => c.phone || '—' },
              { key: 'email', label: 'Email', getText: (c) => c.email || '—' },
              { key: 'gstin', label: 'GSTIN', getText: (c) => c.gstin || '—' },
              { key: 'outstanding', label: 'Outstanding', getText: (c) => formatCurrency(c.current_balance, activeBusiness?.currency_symbol) },
              { key: 'sales', label: 'Total Sales', getText: (c) => formatCurrency(c.total_sales, activeBusiness?.currency_symbol) },
              { key: 'status', label: 'Status', getText: (c) => c.status },
            ]}
            rows={customers}
            filename="customers"
            title="Customers"
            storageKey="customers"
          />
        </div>

        {isError ? (
          <ErrorState title="Unable to load customers." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Add your first customer to start creating invoices"
            action={<Button onClick={() => navigate('/app/customers/new')}><Plus className="h-4 w-4" /> Add Customer</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">GSTIN</th>
                  <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Total Sales</th>
                  <th className="text-center px-4 py-3 font-medium hidden xl:table-cell">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex items-center justify-center text-xs font-semibold shrink-0">
                          {getInitials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-secondary-900 dark:text-secondary-100 truncate">{c.name}</p>
                          {c.company_name && <p className="text-xs text-secondary-400 truncate">{c.company_name}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-secondary-600 dark:text-secondary-300">{c.phone || '—'}</p>
                      <p className="text-xs text-secondary-400">{c.email || ''}</p>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-secondary-600 dark:text-secondary-300 font-mono text-xs">{c.gstin || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={Number(c.current_balance) > 0 ? 'text-warning-600 dark:text-warning-400 font-medium' : 'text-secondary-500'}>
                        {formatCurrency(c.current_balance, activeBusiness?.currency_symbol)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300 hidden sm:table-cell">
                      {formatCurrency(c.total_sales, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-center hidden xl:table-cell">
                      <Badge variant={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setStatementFor(c)} title="Send account statement" className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors">
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
          total={totalCustomers}
          isLoading={isLoading}
        />
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete Customer?"
        message="This will permanently remove the customer. This action cannot be undone."
        confirmText="Delete"
        loading={deleteMutation.isPending}
      />

      <SendDialog
        open={!!statementFor}
        onClose={() => setStatementFor(null)}
        contextLabel={`Statement — ${statementFor?.name ?? ''}`}
        docType="statement"
        docNumber="STATEMENT"
        templateKey="statement_customer"
        templateVariables={{
          customer_name: statementFor?.name || '',
          business_name: activeBusiness?.name || '',
          period_start: formatDate(new Date(Date.now() - 90 * 86400000)),
          period_end: formatDate(new Date()),
          balance: formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Your account statement from ${activeBusiness?.name || 'us'}`}
        defaultMessage={`Dear ${statementFor?.name || 'customer'}, please find your account statement attached. Closing balance: ${formatCurrency(Number(statementFor?.current_balance || 0), activeBusiness?.currency_symbol)}.`}
        recipients={[
          {
            label: statementFor?.company_name || statementFor?.name || 'Customer on record',
            email: statementFor?.email,
            phone: statementFor?.phone,
          },
        ]}
        attachments={[
          {
            id: 'statement-csv',
            label: 'Account statement (CSV)',
            filename: `statement-${(statementFor?.name || 'customer').replace(/\W+/g, '-').toLowerCase()}.csv`,
            build: async () => {
              if (!activeBusiness || !statementFor) throw new Error('Statement is not ready.');
              const { data, error } = await supabase.rpc('get_customer_statement', {
                p_business_id: activeBusiness.id,
                p_customer_id: statementFor.id,
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
