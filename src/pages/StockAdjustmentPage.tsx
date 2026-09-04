import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ArrowLeftRight } from 'lucide-react';
import { formatDate, todayDateString } from '@/lib/utils';
import type { StockMovement, Product } from '@/types/db';

export function StockAdjustmentPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    productId: '', type: 'adjustment_in', quantity: '', notes: '', date: todayDateString(),
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'type-product'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('products').select('*').eq('business_id', activeBusiness.id).eq('type', 'product').order('name');
      return data as Product[];
    },
    enabled: !!activeBusiness,
  });

  const { data: movements, isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-movements', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('stock_movements').select('*, product:products(name, unit)')
        .eq('business_id', activeBusiness.id).in('type', ['adjustment_in', 'adjustment_out'])
        .order('created_at', { ascending: false }).limit(20);
      return data as (StockMovement & { product: { name: string; unit: string } | null })[];
    },
    enabled: !!activeBusiness,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.productId) throw new Error('Please select a product');
      if (!form.quantity || parseFloat(form.quantity) <= 0) throw new Error('Please enter a valid quantity');
      const qty = parseFloat(form.quantity);

      // Atomic server-side: movement + journal in one transaction.
      // A journal failure rolls the movement back - no orphan possible.
      const { data, error } = await supabase.rpc('post_stock_adjustment_atomic', {
        p_business_id: activeBusiness.id,
        p_product_id: form.productId,
        p_type: form.type,
        p_quantity: qty,
        p_notes: form.notes || null,
        p_date: form.date,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-movements', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-value-retail', activeBusiness?.id] });
      toast('Stock adjusted successfully', 'success');
      setForm({ productId: '', type: 'adjustment_in', quantity: '', notes: '', date: todayDateString() });
    },
    onError: (err: any) => toast(err.message || 'Failed to adjust stock', 'error'),
  });

  return (
    <div>
      <PageHeader title="Stock Adjustment" subtitle="Adjust stock levels with full audit trail" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-4">New Adjustment</h3>
          <div className="space-y-4">
            <FormField label="Product" required>
              <select className="input" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Select product...</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name} (Current: {p.current_stock} {p.unit})</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Adjustment Type" required>
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="adjustment_in">Stock In (+)</option>
                  <option value="adjustment_out">Stock Out (-)</option>
                </select>
              </FormField>
              <FormField label="Quantity" required>
                <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
              </FormField>
            </div>
            <FormField label="Reason / Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Reason for adjustment..." />
            </FormField>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} className="w-full">
              <ArrowLeftRight className="h-4 w-4" /> Apply Adjustment
            </Button>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 p-4 border-b border-secondary-200 dark:border-secondary-800">Recent Adjustments</h3>
          {isError ? (
            <ErrorState title="Unable to load stock adjustments." onRetry={() => refetch()} />
          ) : isLoading ? (
            <div className="p-4 space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
          ) : !movements || movements.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="No adjustments yet" description="Stock adjustments will appear here" />
          ) : (
            <div className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{m.product?.name || '—'}</p>
                    <p className="text-xs text-secondary-400">{m.notes} • {formatDate(m.created_at)}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${m.type === 'adjustment_in' ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}>
                    {m.type === 'adjustment_in' ? '+' : ''}{m.quantity} {m.product?.unit || ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
