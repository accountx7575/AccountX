import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Boxes, Search, AlertTriangle, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types/db';

type ValuationRow = {
  product_id: string;
  product_name: string;
  quantity: number;
  total_value: number;
  avg_cost: number;
};

export function StockPage() {
  const { activeBusiness } = useAuth();
  const [search, setSearch] = useState('');

  const { data: products, isLoading, isError, refetch } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'type-product'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('products').select('*').eq('business_id', activeBusiness.id).eq('type', 'product').order('name');
      return data as Product[];
    },
    enabled: !!activeBusiness,
  });

  // T41 rider: cost-basis valuation (qty x avg_cost) supersedes retail-price value
  const { data: valuation } = useQuery({
    queryKey: ['stock-valuation', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as ValuationRow[];
      const { data, error } = await supabase.rpc('get_stock_valuation', {
        p_business_id: activeBusiness.id,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ValuationRow[];
    },
    enabled: !!activeBusiness,
  });

  const valuationByProduct = useMemo(() => {
    const map = new Map<string, ValuationRow>();
    for (const row of valuation ?? []) map.set(row.product_id, row);
    return map;
  }, [valuation]);

  const filtered = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [products, search]);

  // '(All products)' basis — computed over the full valuation set, not the search filter
  const totalStockValue = (valuation ?? []).reduce((s, r) => s + Number(r.total_value), 0);
  const lowStock = filtered.filter((p) => Number(p.minimum_stock) > 0 && Number(p.current_stock) <= Number(p.minimum_stock));
  const outOfStock = filtered.filter((p) => Number(p.current_stock) <= 0);

  const cards = [
    { label: 'Total Products', value: String(filtered.length), icon: Package, color: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30' },
    { label: 'Stock Value (All products, at cost)', value: formatCurrency(totalStockValue, activeBusiness?.currency_symbol), icon: Boxes, color: 'text-accent-600 bg-accent-50 dark:bg-accent-900/30' },
    { label: 'Low Stock', value: String(lowStock.length), icon: AlertTriangle, color: 'text-warning-600 bg-warning-50 dark:bg-warning-900/30' },
    { label: 'Out of Stock', value: String(outOfStock.length), icon: AlertTriangle, color: 'text-error-600 bg-error-50 dark:bg-error-900/30' },
  ];

  return (
    <div>
      <PageHeader title="Stock Overview" subtitle="Real-time inventory status across all products" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className={`rounded-lg p-2 ${c.color} w-fit mb-3`}><c.icon className="h-4 w-4" /></div>
            <p className="text-xs text-secondary-500 dark:text-secondary-400">{c.label}</p>
            <p className="text-lg font-bold text-secondary-900 dark:text-secondary-100 tabular-nums">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </div>
        {isError ? (
          <ErrorState title="Unable to load stock overview." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1,2,3,4].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Boxes} title="No products in stock" description="Add products to track inventory" />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Product</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">HSN/SAC</th>
                  <th className="text-right px-4 py-3 font-medium">Current Stock</th>
                  <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Min Stock</th>
                  <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Avg Cost</th>
                  <th className="text-right px-4 py-3 font-medium">Value (at cost)</th>
                  <th className="text-center px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const isLow = Number(p.minimum_stock) > 0 && Number(p.current_stock) <= Number(p.minimum_stock);
                  const isOut = Number(p.current_stock) <= 0;
                  const val = valuationByProduct.get(p.id);
                  return (
                    <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                      <td className="px-4 py-3">
                        <p className="font-medium text-secondary-900 dark:text-secondary-100">{p.name}</p>
                        {p.sku && <p className="text-xs text-secondary-400">{p.sku}</p>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-secondary-500 font-mono text-xs">{p.hsn_sac || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-secondary-900 dark:text-secondary-100">{val ? val.quantity : p.current_stock} {p.unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell text-secondary-500">{p.minimum_stock} {p.unit}</td>
                      <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell text-secondary-600 dark:text-secondary-300">{formatCurrency(val?.avg_cost ?? 0, activeBusiness?.currency_symbol)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100">{formatCurrency(val?.total_value ?? 0, activeBusiness?.currency_symbol)}</td>
                      <td className="px-4 py-3 text-center">
                        {isOut ? <Badge variant="error">Out of Stock</Badge> : isLow ? <Badge variant="warning">Low</Badge> : <Badge variant="success">In Stock</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
