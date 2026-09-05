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
import { Package, Plus, Pencil, Archive, Boxes } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types/db';

export function ProductsPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = usePagedList();
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['products', activeBusiness?.id, { q: list.debouncedSearch, page: list.page, pageSize: list.pageSize }],
    queryFn: async () => {
      if (!activeBusiness) return { rows: [] as Product[], total: 0 };
      let q = supabase
        .from('products')
        .select('*', { count: 'exact' })
        .eq('business_id', activeBusiness.id)
        .eq('is_active', true);
      if (list.debouncedSearch) {
        const p = likePattern(list.debouncedSearch);
        q = q.or(`name.ilike."${p}",sku.ilike."${p}",hsn_sac.ilike."${p}"`);
      }
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(list.from, list.to);
      if (error) throw error;
      return { rows: (data || []) as Product[], total: count ?? 0 };
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });
  const products = data?.rows ?? [];
  const totalProducts = data?.total ?? 0;

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      toast('Product archived', 'success');
      setArchiveId(null);
    },
    onError: (err: any) => toast(err.message || 'Failed to archive product', 'error'),
  });

  const openEdit = (p: Product) => {
    navigate(`/app/products/${p.id}/edit`);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={`${totalProducts} product${totalProducts !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/products/new')}><Plus className="h-4 w-4" /> Add Product</Button>}
      />

      <div className="card">
        <ListToolbar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search by name, SKU, HSN/SAC..."
          pageSize={list.pageSize}
          onPageSizeChange={list.setPageSize}
        />

        {isError ? (
          <ErrorState title="Unable to load products." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">
            {[1,2,3,4,5].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Add your first product or service to start invoicing"
            action={<Button onClick={() => navigate('/app/products/new')}><Plus className="h-4 w-4" /> Add Product</Button>}
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Product</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Type</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">HSN/SAC</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Purchase Price</th>
                  <th className="text-right px-4 py-3 font-medium">Selling Price</th>
                  <th className="text-right px-4 py-3 font-medium hidden sm:table-cell">Stock</th>
                  <th className="text-center px-4 py-3 font-medium">Tax</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 flex items-center justify-center shrink-0">
                          {p.type === 'service' ? <Package className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-secondary-900 dark:text-secondary-100 truncate">{p.name}</p>
                          {p.sku && <p className="text-xs text-secondary-400">SKU: {p.sku}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <Badge variant={p.type === 'product' ? 'info' : 'neutral'}>{p.type}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-secondary-600 dark:text-secondary-300 font-mono text-xs">{p.hsn_sac || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-secondary-600 dark:text-secondary-300 hidden md:table-cell">
                      {formatCurrency(p.purchase_price, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100">
                      {formatCurrency(p.selling_price, activeBusiness?.currency_symbol)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden sm:table-cell">
                      {p.type === 'product' ? (
                        <span className={Number(p.current_stock) <= Number(p.minimum_stock) && Number(p.minimum_stock) > 0 ? 'text-error-600 dark:text-error-400 font-medium' : 'text-secondary-600 dark:text-secondary-300'}>
                          {p.current_stock} {p.unit}
                        </span>
                      ) : (
                        <span className="text-secondary-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-secondary-600 dark:text-secondary-300">{p.tax_rate}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(p)} title="Edit product" className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setArchiveId(p.id)} className="p-1.5 rounded-md text-secondary-400 hover:text-warning-600 hover:bg-warning-50 dark:hover:bg-warning-900/30 transition-colors" title="Archive product">
                          <Archive className="h-3.5 w-3.5" />
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
          total={totalProducts}
          isLoading={isLoading}
        />
      </div>

      <ConfirmDialog
        open={!!archiveId}
        onClose={() => setArchiveId(null)}
        onConfirm={() => archiveId && archiveMutation.mutate(archiveId)}
        title="Archive Product?"
        message="The product will be hidden from active lists and can no longer be transacted. Its history is preserved."
        confirmText="Archive"
        loading={archiveMutation.isPending}
      />
    </div>
  );
}
