import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea, Select } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ArrowLeftRight } from 'lucide-react';
import { formatDate, todayDateString } from '@/lib/utils';
import type { Product } from '@/types/db';

interface DisplayAdjustment {
  id: string;
  product: { name: string; unit: string } | null;
  notes: string | null;
  created_at: string;
  quantity: number;
  isDecrease: boolean;
}

export function StockAdjustmentPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    productId: '',
    type: 'Stock In',
    quantity: '',
    notes: '',
    date: todayDateString(),
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'type-product'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('type', 'product')
        .order('name');
      return data as Product[];
    },
    enabled: !!activeBusiness,
  });

  const { data: adjustments, isLoading, isError, refetch } = useQuery({
    queryKey: ['stock-adjustments', activeBusiness?.id],
    queryFn: async (): Promise<DisplayAdjustment[]> => {
      if (!activeBusiness) return [];

      // Query stock_adjustments first
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .select('*, product:products(name, unit)')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (!adjError && adjData && adjData.length > 0) {
        return adjData.map((a: any) => ({
          id: a.id,
          product: a.product,
          notes: a.reason,
          created_at: a.created_at,
          quantity: a.quantity,
          isDecrease:
            a.adjustment_type === 'Stock Out' ||
            a.adjustment_type === 'decrease' ||
            a.adjustment_type === 'adjustment_out',
        }));
      }

      // Fallback to stock_movements if no stock_adjustments found yet
      const { data: movData } = await supabase
        .from('stock_movements')
        .select('*, product:products(name, unit)')
        .eq('business_id', activeBusiness.id)
        .in('type', ['adjustment_in', 'adjustment_out'])
        .order('created_at', { ascending: false })
        .limit(20);

      return (movData || []).map((m: any) => ({
        id: m.id,
        product: m.product,
        notes: m.notes,
        created_at: m.created_at,
        quantity: Math.abs(m.quantity),
        isDecrease: m.type === 'adjustment_out' || m.quantity < 0,
      }));
    },
    enabled: !!activeBusiness,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.productId) throw new Error('Please select a product');
      if (!form.quantity || parseFloat(form.quantity) <= 0) throw new Error('Please enter a valid quantity');
      const qty = parseFloat(form.quantity);

      const isDecrease =
        form.type === 'Stock Out' ||
        form.type === 'decrease' ||
        form.type === 'adjustment_out';

      // 1. Fetch current product stock
      const { data: prod, error: prodFetchError } = await supabase
        .from('products')
        .select('id, name, current_stock')
        .eq('id', form.productId)
        .eq('business_id', activeBusiness.id)
        .single();

      if (prodFetchError || !prod) {
        throw new Error(prodFetchError?.message || 'Product not found');
      }

      const currentStock = Number(prod.current_stock) || 0;
      const newStock = isDecrease ? currentStock - qty : currentStock + qty;

      // 2. Insert into stock_adjustments table
      const { data: adjustment, error: adjError } = await supabase
        .from('stock_adjustments')
        .insert({
          business_id: activeBusiness.id,
          product_id: form.productId,
          adjustment_type: form.type, // 'Stock In' | 'Stock Out'
          quantity: qty,
          reason: form.notes || null,
        })
        .select()
        .single();

      if (adjError) {
        throw adjError;
      }

      // 3. Update products row directly so the stock reflects accurately across the app
      const { error: updateError } = await supabase
        .from('products')
        .update({ current_stock: newStock })
        .eq('id', form.productId)
        .eq('business_id', activeBusiness.id);

      if (updateError) {
        throw updateError;
      }

      // 4. Defensively record to stock_movements for audit history
      try {
        await supabase.from('stock_movements').insert({
          business_id: activeBusiness.id,
          product_id: form.productId,
          type: isDecrease ? 'adjustment_out' : 'adjustment_in',
          quantity: isDecrease ? -qty : qty,
          balance_after: newStock,
          reference_type: 'stock_adjustment',
          reference_id: adjustment?.id || null,
          notes: form.notes || (isDecrease ? 'Stock Out' : 'Stock In'),
        });
      } catch (smErr) {
        console.warn('[StockAdjustment] Non-fatal stock_movements sync warning:', smErr);
      }

      return adjustment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-value-retail', activeBusiness?.id] });
      toast('Stock adjusted successfully', 'success');
      setForm({ productId: '', type: 'Stock In', quantity: '', notes: '', date: todayDateString() });
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
              <Select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                <option value="">Select product...</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.name} (Current: {p.current_stock} {p.unit})</option>)}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Adjustment Type" required>
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="Stock In">Stock In (+)</option>
                  <option value="Stock Out">Stock Out (-)</option>
                </Select>
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
          ) : !adjustments || adjustments.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="No adjustments yet" description="Stock adjustments will appear here" />
          ) : (
            <div className="divide-y divide-secondary-100 dark:divide-secondary-800">
              {adjustments.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{m.product?.name || '—'}</p>
                    <p className="text-xs text-secondary-400">{m.notes || '—'} • {formatDate(m.created_at)}</p>
                  </div>
                  <span className={`text-sm font-medium tabular-nums ${!m.isDecrease ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}>
                    {!m.isDecrease ? '+' : '-'}{m.quantity} {m.product?.unit || ''}
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
