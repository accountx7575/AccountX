import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { usePagedList, likePattern } from '@/hooks/usePagedList';
import { ListToolbar, ListPagination } from '@/components/ui/ListControls';
import { Receipt, Plus } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Expense } from '@/types/db';

export function ExpensesPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const list = usePagedList();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['expenses', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as (Expense & { category: { name: string } | null })[], total: 0 };
      let q = supabase.from('expenses').select('*, category:expense_categories(name)', { count: 'exact' })
        .eq('business_id', activeBusiness.id);
      if (list.debouncedSearch) {
        const p = likePattern(list.debouncedSearch);
        q = q.or(`expense_number.ilike."${p}",description.ilike."${p}"`);
      }
      const { data, error, count } = await q.order('created_at', { ascending: false }).range(list.from, list.to);
      if (error) throw error;
      return { rows: (data || []) as (Expense & { category: { name: string } | null })[], total: count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const expenses = data?.rows ?? [];
  const totalExpenses = data?.total ?? 0;

  return (
    <div>
      <PageHeader title="Expenses" subtitle={`${totalExpenses} expense${totalExpenses !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/expenses/new')}><Plus className="h-4 w-4" /> Add Expense</Button>} />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by number or description..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />
        {isError ? (
          <ErrorState title="Unable to load expenses." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses yet" description="Record your business expenses" action={<Button onClick={() => navigate('/app/expenses/new')}><Plus className="h-4 w-4" /> Add Expense</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Expense No.</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Description</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-500">{e.expense_number}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-600 dark:text-secondary-300">{e.category?.name || '—'}</td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{e.description || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-500">{formatDate(e.date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-error-600 dark:text-error-400">{formatCurrency(e.total_amount, activeBusiness?.currency_symbol)}</td>
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
          total={totalExpenses}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}
