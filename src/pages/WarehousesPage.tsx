import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import type { Warehouse } from '@/types/db';

type WarehouseForm = { name: string; address: string; city: string; state: string; is_default: boolean };

const emptyForm: WarehouseForm = { name: '', address: '', city: '', state: '', is_default: false };

export function WarehousesPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<WarehouseForm>({ ...emptyForm });
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null);
  const [deleteBlockedMsg, setDeleteBlockedMsg] = useState<string | null>(null);
  const [stockViewing, setStockViewing] = useState<Warehouse | null>(null);

  const invalidateAll = () => {
    ['warehouses', 'warehouse-stock', 'warehouse-warehouses'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
    );
    queryClient.invalidateQueries({ queryKey: ['warehouses', activeBusiness?.id] });
  };

  const { data: warehouses, isLoading, isError, refetch } = useQuery({
    queryKey: ['warehouses', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [] as Warehouse[];
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return (data || []) as Warehouse[];
    },
    enabled: !!activeBusiness,
    placeholderData: (prev) => prev,
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDeleteBlockedMsg(null);
    setFormOpen(true);
  };

  const openEdit = (w: Warehouse) => {
    setEditing(w);
    setForm({ name: w.name, address: w.address || '', city: w.city || '', state: w.state || '', is_default: w.is_default });
    setDeleteBlockedMsg(null);
    setFormOpen(true);
  };

  // One save flow for the one-default-per-business rule: clear any OTHER
  // default first, then persist this row — mirrors the partial UNIQUE index.
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const name = form.name.trim();
      if (!name) throw new Error('Warehouse name is required');

      if (form.is_default && editing?.is_default !== true) {
        const { error: clearErr } = await supabase
          .from('warehouses')
          .update({ is_default: false })
          .eq('business_id', activeBusiness.id)
          .neq('id', editing?.id ?? '00000000-0000-0000-0000-000000000000');
        if (clearErr) throw clearErr;
      }

      const payload = {
        name,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        is_default: form.is_default,
      };

      if (editing) {
        const { error } = await supabase
          .from('warehouses')
          .update(payload)
          .eq('id', editing.id)
          .eq('business_id', activeBusiness.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('warehouses')
          .insert({ ...payload, business_id: activeBusiness.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      invalidateAll();
      toast(editing ? 'Warehouse updated' : 'Warehouse created', 'success');
      setFormOpen(false);
    },
    onError: (err: any) => toast(err.message || 'Failed to save warehouse', 'error'),
  });

  // Single attempt only: the 040 delete guard RAISEs with an actionable
  // message when history exists. We render that honestly - never retry-loop.
  const deleteMutation = useMutation({
    mutationFn: async (w: Warehouse) => {
      const { error } = await supabase
        .from('warehouses')
        .delete()
        .eq('id', w.id)
        .eq('business_id', activeBusiness!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast('Warehouse deleted', 'success');
      setConfirmDelete(null);
      setDeleteBlockedMsg(null);
    },
    onError: (err: any) => {
      setConfirmDelete(null);
      setDeleteBlockedMsg(err.message || 'This warehouse cannot be deleted.');
    },
  });

  return (
    <div>
      <PageHeader
        title="Warehouses"
        subtitle={`${warehouses?.length ?? 0} location${(warehouses?.length ?? 0) !== 1 ? 's' : ''}`}
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New Warehouse</Button>}
      />

      {deleteBlockedMsg && (
        <div className="card p-4 mb-4 border-l-4 border-warning-500 bg-warning-50 dark:bg-warning-900/20">
          <p className="text-sm text-warning-700 dark:text-warning-300">{deleteBlockedMsg}</p>
          <p className="text-xs text-secondary-500 dark:text-secondary-400 mt-1">
            A warehouse with movement or transfer history must stay — its records have to remain attributable.
          </p>
        </div>
      )}

      <div className="card">
        {isError ? (
          <ErrorState title="Unable to load warehouses." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : !warehouses || warehouses.length === 0 ? (
          <EmptyState icon={Boxes} title="No warehouses yet"
            description="Add your first storage location to attribute stock movements per warehouse."
            action={<Button onClick={openCreate}><Plus className="h-4 w-4" /> New Warehouse</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Address</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">City</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">State</th>
                  <th className="text-left px-4 py-3 font-medium">Default</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(warehouses || []).map((w) => (
                  <tr key={w.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-secondary-900 dark:text-secondary-100">{w.name}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-500 max-w-[16rem] truncate">{w.address || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{w.city || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{w.state || '—'}</td>
                    <td className="px-4 py-3">
                      {w.is_default ? (
                        <span className="badge bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"><Star className="h-3 w-3" /> Default</span>
                      ) : (
                        <span className="text-secondary-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end items-center gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setStockViewing(w)}>Stock</Button>
                        <button onClick={() => openEdit(w)} title="Edit warehouse"
                          className="p-1.5 rounded-md text-secondary-400 hover:text-secondary-600 dark:hover:text-secondary-200 hover:bg-secondary-100 dark:hover:bg-secondary-800 transition-colors">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setDeleteBlockedMsg(null); setConfirmDelete(w); }} title="Delete warehouse"
                          className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 dark:hover:text-error-400 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer open={formOpen} onClose={() => setFormOpen(false)} width="md" title={editing ? `Edit ${editing.name}` : 'New Warehouse'}>
        <div className="space-y-4">
          <FormField label="Name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Godown" />
          </FormField>
          <FormField label="Address">
            <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="Street address..." />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="City">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" />
            </FormField>
            <FormField label="State">
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-secondary-700 dark:text-secondary-300 cursor-pointer">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} className="accent-indigo-600" />
            Set as default warehouse
            {form.is_default && editing?.is_default === false ? (
              <span className="text-xs text-secondary-400">(current default will be cleared)</span>
            ) : null}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
              {editing ? 'Save Changes' : 'Create Warehouse'}
            </Button>
          </div>
        </div>
      </Drawer>

      <Drawer open={!!stockViewing} onClose={() => setStockViewing(null)} width="md" title={`Stock at ${stockViewing?.name ?? ''}`}>
        {stockViewing && <WarehouseStock warehouseId={stockViewing.id} />}
      </Drawer>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
        title={`Delete ${confirmDelete?.name ?? 'warehouse'}?`}
        message="Only possible when this warehouse has no stock movements or transfer history."
        confirmText="Delete"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function WarehouseStock({ warehouseId }: { warehouseId: string }) {
  const { activeBusiness } = useAuth();
  const stock = useQuery({
    queryKey: ['warehouse-stock-detail', activeBusiness?.id, warehouseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_warehouse_stock')
        .select('product_name, quantity, last_movement_at')
        .eq('business_id', activeBusiness!.id)
        .eq('warehouse_id', warehouseId)
        .order('product_name');
      if (error) throw new Error(error.message);
      return data as { product_name: string; quantity: number; last_movement_at: string }[];
    },
  });

  return (
    <div>
      <p className="text-xs text-secondary-400 mb-3 flex items-start gap-1.5">
        <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Attributed movements only. Legacy stock recorded before warehouse tracking stays in product totals but cannot be attributed to a location.
      </p>
      {stock.isError ? (
        <ErrorState title="Unable to load warehouse stock." onRetry={() => stock.refetch()} />
      ) : stock.isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
      ) : !stock.data || stock.data.length === 0 ? (
        <EmptyState icon={Boxes} title="No attributed stock here" description="Movements assigned to this warehouse will appear." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
              <th className="text-left px-3 py-2 font-medium">Product</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
            </tr>
          </thead>
          <tbody>
            {stock.data.map((r) => (
              <tr key={r.product_name} className="border-b border-secondary-100 dark:border-secondary-800/50">
                <td className="px-3 py-2 text-secondary-900 dark:text-secondary-100">{r.product_name}</td>
                <td className="px-3 py-2 text-right tabular-nums figure font-medium">{Math.round(Number(r.quantity) * 100) / 100}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
