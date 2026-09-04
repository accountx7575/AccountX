import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { DatePicker } from '@/components/common/DatePicker';
import { todayDateString } from '@/lib/utils';
import type { Product, Warehouse } from '@/types/db';

type TransferLine = { product_id: string; quantity: string };

const emptyLine: TransferLine = { product_id: '', quantity: '' };

export function StockTransferCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([{ ...emptyLine }]);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayDateString());

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as Warehouse[];
      const { data } = await supabase
        .from('warehouses')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .order('name');
      return (data || []) as Warehouse[];
    },
    enabled: !!activeBusiness,
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'type-product'],
    queryFn: async () => {
      if (!activeBusiness) return [] as Product[];
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('type', 'product')
        .order('name');
      return (data || []) as Product[];
    },
    enabled: !!activeBusiness,
  });

  // Live per-warehouse availability at the chosen source (attributed movements
  // only — legacy NULL-warehouse rows are excluded server-side by design).
  const { data: sourceStock } = useQuery({
    queryKey: ['warehouse-stock', activeBusiness?.id, fromWh],
    queryFn: async () => {
      if (!activeBusiness || !fromWh) return new Map<string, number>();
      const { data, error } = await supabase
        .from('v_warehouse_stock')
        .select('product_id, quantity')
        .eq('business_id', activeBusiness.id)
        .eq('warehouse_id', fromWh);
      if (error) throw new Error(error.message);
      const m = new Map<string, number>();
      for (const r of (data || []) as { product_id: string; quantity: number }[]) m.set(r.product_id, Number(r.quantity));
      return m;
    },
    enabled: !!activeBusiness && !!fromWh,
  });

  const duplicateIds = useMemo(() => {
    const ids = lines.map((l) => l.product_id).filter(Boolean);
    return new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  }, [lines]);

  const validate = (): string | null => {
    if (!fromWh) return 'Please select a source warehouse';
    if (!toWh) return 'Please select a destination warehouse';
    if (fromWh === toWh) return 'Source and destination warehouses must differ';
    if (lines.length === 0) return 'At least one line item is required';
    for (const l of lines) {
      if (!l.product_id) return 'Every line needs a product';
      const qty = parseFloat(l.quantity);
      if (!l.quantity || isNaN(qty) || qty <= 0) return 'Quantities must be positive numbers';
      if (duplicateIds.has(l.product_id)) return 'Duplicate product lines are not allowed';
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const problem = validate();
      if (problem) throw new Error(problem);
      const { data, error } = await supabase.rpc('execute_stock_transfer', {
        p_business_id: activeBusiness.id,
        p_from_warehouse_id: fromWh,
        p_to_warehouse_id: toWh,
        p_items: lines.map((l) => ({ product_id: l.product_id, quantity: parseFloat(l.quantity) })),
        p_notes: notes.trim() || null,
        p_transfer_date: date,
      });
      if (error) throw error;
      return data as { transfer_id: string; transfer_number: string };
    },
    onSuccess: (res) => {
      ['stock-transfers', 'products', 'stock-movements', 'warehouse-stock', 'stock-valuation', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast(`Stock transfer ${res?.transfer_number ?? ''} completed`, 'success');
      navigate('/app/stock-transfer');
    },
    onError: (err: any) => toast(err.message || 'Failed to execute stock transfer', 'error'),
  });

  const setLine = (idx: number, patch: Partial<TransferLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const availabilityFor = (productId: string): number | null => {
    if (!sourceStock || !productId) return null;
    const v = sourceStock.get(productId);
    return v == null ? 0 : v;
  };

  return (
    <div>
      <PageHeader
        title="New Stock Transfer"
        subtitle="Move stock between warehouses — value-preserving, fully attributed"
        actions={<Button variant="secondary" onClick={() => navigate('/app/stock-transfer')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="max-w-3xl space-y-4">
        <div className="card p-6">
          <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 mb-4">Route</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="From warehouse" required>
              <select className="input" value={fromWh} onChange={(e) => setFromWh(e.target.value)}>
                <option value="">Select source...</option>
                {(warehouses || []).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </FormField>
            <FormField label="To warehouse" required>
              <select className="input" value={toWh} onChange={(e) => setToWh(e.target.value)}>
                <option value="">Select destination...</option>
                {(warehouses || []).filter((w) => w.id !== fromWh).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (default)' : ''}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Transfer date">
              <DatePicker value={date} onChange={(iso) => setDate(iso)} />
            </FormField>
          </div>
          {!warehouses || warehouses.length < 2 ? (
            <p className="text-xs text-warning-600 dark:text-warning-400 mt-3">
              Stock transfers need at least two warehouses. Create more under Warehouses first.
            </p>
          ) : null}
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Items</h3>
            <Button size="sm" variant="secondary" onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-secondary-400">No lines yet — add one to continue.</p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const avail = availabilityFor(line.product_id);
                const overAvail = avail != null && parseFloat(line.quantity) > avail;
                return (
                  <div key={idx} className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[14rem]">
                      <FormField label="Product">
                        <select className="input" value={line.product_id} onChange={(e) => setLine(idx, { product_id: e.target.value })}>
                          <option value="">Select product...</option>
                          {(products || []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {avail != null ? ` — at source: ${avail} ${p.unit}` : ''}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                    <div className="w-28">
                      <FormField label="Qty">
                        <Input type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} placeholder="0" />
                      </FormField>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} title="Remove line">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {overAvail && (
                      <p className="basis-full text-xs text-error-600 dark:text-error-400 -mt-1">
                        Requested {parseFloat(line.quantity)} exceeds availability at the source warehouse ({avail}).
                      </p>
                    )}
                    {duplicateIds.has(line.product_id) && (
                      <p className="basis-full text-xs text-error-600 dark:text-error-400 -mt-1">This product is already on another line.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-6">
          <FormField label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Reason / reference for this transfer..." />
          </FormField>
          <p className="text-xs text-secondary-400 mt-3">
            No journal entry is created — an internal move is not a financial event. Both movement legs carry FIFO cost so inventory value is preserved exactly.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex justify-end">
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <ArrowLeftRight className="h-4 w-4" /> Execute Transfer
          </Button>
        </div>
      </div>
    </div>
  );
}
