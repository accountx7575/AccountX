import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ErrorState } from '@/components/ui/ErrorState';
import { ArrowLeft, Save } from 'lucide-react';
import type { Product } from '@/types/db';

const emptyForm = {
  name: '', sku: '', barcode: '', type: 'product', hsn_sac: '', unit: 'PCS',
  purchase_price: '0', selling_price: '0', tax_rate: '0', tax_inclusive: false,
  opening_stock: '0', minimum_stock: '0', description: '', category_id: '',
};

export function ProductCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);
  const [form, setForm] = useState(emptyForm);

  // Edit mode: load the existing product (scoped to the active business so
  // one tenant can never preload another tenant's record) and pre-fill.
  const existingQuery = useQuery({
    queryKey: ['product', activeBusiness?.id, editId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', activeBusiness!.id)
        .eq('id', editId!)
        .single();
      if (error) throw error;
      return data as Product;
    },
    enabled: isEdit && !!activeBusiness,
  });

  useEffect(() => {
    const p = existingQuery.data;
    if (!p) return;
    setForm({
      name: p.name, sku: p.sku || '', barcode: p.barcode || '', type: p.type,
      hsn_sac: p.hsn_sac || '', unit: p.unit, purchase_price: String(p.purchase_price),
      selling_price: String(p.selling_price), tax_rate: String(p.tax_rate),
      tax_inclusive: p.tax_inclusive, opening_stock: String(p.opening_stock),
      minimum_stock: String(p.minimum_stock), description: p.description || '',
      category_id: p.category_id || '',
    });
  }, [existingQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.name.trim()) throw new Error('Please enter a product name');
      const base = {
        business_id: activeBusiness.id,
        category_id: form.category_id || null,
        name: form.name,
        sku: form.sku || null,
        barcode: form.barcode || null,
        type: form.type,
        hsn_sac: form.hsn_sac || null,
        unit: form.unit,
        purchase_price: parseFloat(form.purchase_price) || 0,
        selling_price: parseFloat(form.selling_price) || 0,
        tax_rate: parseFloat(form.tax_rate) || 0,
        tax_inclusive: form.tax_inclusive,
        opening_stock: parseFloat(form.opening_stock) || 0,
        minimum_stock: parseFloat(form.minimum_stock) || 0,
        description: form.description || null,
        is_active: true,
      };
      if (isEdit) {
        // Update path: never touch live current_stock here — stock moves
        // through stock movements, not the edit form.
        const { error } = await supabase
          .from('products')
          .update(base)
          .eq('business_id', activeBusiness.id)
          .eq('id', editId!);
        if (error) throw error;
        return;
      }
      const payload = { ...base, current_stock: parseFloat(form.opening_stock) || 0 };
      const { data: newProduct, error } = await supabase.from('products').insert(payload).select().single();
      if (error) throw error;
      if (newProduct && Number(payload.opening_stock) > 0) {
        await supabase.from('stock_movements').insert({
          business_id: activeBusiness.id,
          product_id: newProduct.id,
          type: 'opening',
          quantity: Number(payload.opening_stock),
          balance_after: Number(payload.opening_stock),
          notes: 'Opening stock',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['product', activeBusiness?.id, editId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', activeBusiness?.id] });
      toast(isEdit ? 'Product updated successfully' : 'Product added successfully', 'success');
      navigate('/app/products');
    },
    onError: (err: any) => toast(err.message || 'Failed to save product', 'error'),
  });

  if (isEdit && existingQuery.isError) {
    return (
      <div>
        <PageHeader
          title="Edit Product"
          actions={<Button variant="secondary" onClick={() => navigate('/app/products')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
        />
        <ErrorState title="Unable to load this product." onRetry={() => existingQuery.refetch()} />
      </div>
    );
  }

  const formLoading = isEdit && existingQuery.isLoading;

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit Product' : 'New Product'}
        actions={<Button variant="secondary" onClick={() => navigate('/app/products')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      {formLoading ? (
        <div className="card p-6 space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}
        </div>
      ) : (
      <div className="card p-6">
        <FormSection title="Identity">
          <div className="space-y-4">
            <FormField label="Product Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Laptop" />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Type">
                <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="product">Product</option>
                  <option value="service">Service</option>
                </select>
              </FormField>
              <FormField label="Unit">
                <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="PCS" />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="SKU">
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="LAP-001" />
              </FormField>
              <FormField label="Barcode">
                <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="8901234567890" />
              </FormField>
            </div>
          </div>
        </FormSection>

        <FormSection title="Tax & Pricing">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="HSN/SAC Code">
              <Input value={form.hsn_sac} onChange={(e) => setForm({ ...form, hsn_sac: e.target.value })} placeholder="8471" />
            </FormField>
            <FormField label="Tax Rate (%)">
              <Input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} placeholder="18" />
            </FormField>
            <FormField label="Purchase Price">
              <Input type="number" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} placeholder="0.00" />
            </FormField>
            <FormField label="Selling Price">
              <Input type="number" value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} placeholder="0.00" />
            </FormField>
          </div>
        </FormSection>

        {form.type === 'product' && (
          <FormSection title="Stock" description="Opening quantity is posted as an opening stock movement on save">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Opening Stock">
                <Input type="number" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: e.target.value })} placeholder="0" />
              </FormField>
              <FormField label="Minimum Stock">
                <Input type="number" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value })} placeholder="5" />
              </FormField>
            </div>
          </FormSection>
        )}

        <FormSection title="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Product description..." />
        </FormSection>
      </div>
      )}

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/products')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={formLoading}>
            <Save className="h-4 w-4" /> {isEdit ? 'Update Product' : 'Save Product'}
          </Button>
        </div>
      </div>
    </div>
  );
}
