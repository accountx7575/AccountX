import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { Plus, Trash2, Search, Save, ArrowLeft } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { computeDocLine } from '@/lib/payloads';
import type { Supplier, Product } from '@/types/db';

type LineItem = {
  product_id: string | null;
  product_name: string;
  hsn_sac: string;
  quantity: number;
  unit: string;
  rate: number;
  discount_amount: number;
  tax_rate: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_amount: number;
};

const emptyItem: LineItem = {
  product_id: null, product_name: '', hsn_sac: '', quantity: 1, unit: 'PCS',
  rate: 0, discount_amount: 0, tax_rate: 0, taxable_amount: 0,
  cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_amount: 0,
};

export function PurchaseBillCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayDateString());
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyItem }]);
  const [notes, setNotes] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [searchIdx, setSearchIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('suppliers').select('*').eq('business_id', activeBusiness.id).eq('status', 'active').order('name');
      return data as Supplier[];
    },
    enabled: !!activeBusiness,
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'active'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('products').select('*').eq('business_id', activeBusiness.id).eq('is_active', true).order('name');
      return data as Product[];
    },
    enabled: !!activeBusiness,
  });

  const isInterState = useMemo(() => {
    if (!activeBusiness || !supplierId || !suppliers) return false;
    const supplier = suppliers.find((s) => s.id === supplierId);
    return Boolean(supplier && supplier.state && supplier.state !== activeBusiness.state);
  }, [activeBusiness, supplierId, suppliers]);

  const totals = useMemo(() => {
    let subtotal = 0, totalDiscount = 0, taxableAmount = 0;
    let cgst = 0, sgst = 0, igst = 0;
    items.forEach((item) => {
      const line = computeDocLine({
        quantity: item.quantity,
        rate: item.rate,
        discount_amount: item.discount_amount,
        tax_rate: item.tax_rate,
        isInterState,
      });
      subtotal += line.gross_amount;
      totalDiscount += roundTo2(item.discount_amount);
      taxableAmount += line.taxable_amount;
      cgst += line.cgst_amount;
      sgst += line.sgst_amount;
      igst += line.igst_amount;
    });
    const totalTax = roundTo2(cgst + sgst + igst);
    const beforeRound = roundTo2(taxableAmount + totalTax);
    const roundOff = roundTo2(Math.round(beforeRound) - beforeRound);
    const grandTotal = roundTo2(beforeRound + roundOff);
    return { subtotal, totalDiscount, taxableAmount, cgst: roundTo2(cgst), sgst: roundTo2(sgst), igst: roundTo2(igst), roundOff, grandTotal };
  }, [items, isInterState]);

  const updateItem = (idx: number, updates: Partial<LineItem>) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const u = { ...it, ...updates };
      const line = computeDocLine({
        quantity: u.quantity,
        rate: u.rate,
        discount_amount: u.discount_amount,
        tax_rate: u.tax_rate,
        isInterState,
      });
      u.taxable_amount = line.taxable_amount;
      u.cgst_amount = line.cgst_amount;
      u.sgst_amount = line.sgst_amount;
      u.igst_amount = line.igst_amount;
      u.total_amount = line.total_amount;
      return u;
    }));
  };

  const selectProduct = (idx: number, product: Product) => {
    updateItem(idx, {
      product_id: product.id, product_name: product.name, hsn_sac: product.hsn_sac || '',
      unit: product.unit, rate: product.purchase_price, tax_rate: product.tax_rate,
    });
    setSearchIdx(null);
    setProductSearch('');
  };

  const addItem = () => setItems((prev) => [...prev, { ...emptyItem }]);
  const removeItem = (idx: number) => setItems((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const saveMutation = useMutation({
    mutationFn: async (status: 'confirmed' | 'draft' = 'confirmed') => {
      if (!activeBusiness) throw new Error('No active business');
      if (!supplierId) throw new Error('Please select a supplier');
      if (items.some((it) => !it.product_name || it.quantity <= 0)) throw new Error('Please fill all item details');
      setSaving(true);

      const p_bill: Record<string, unknown> = {
        supplier_id: supplierId,
        bill_date: billDate,
        due_date: dueDate || null,
        subtotal: totals.subtotal,
        discount_amount: totals.totalDiscount,
        taxable_amount: totals.taxableAmount,
        cgst_amount: totals.cgst,
        sgst_amount: totals.sgst,
        igst_amount: totals.igst,
        cess_amount: 0,
        round_off: totals.roundOff,
        grand_total: totals.grandTotal,
        notes: notes || null,
      };
      if (billNumber.trim()) {
        p_bill.bill_number = billNumber.trim();
      }

      const p_items = items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        hsn_sac: it.hsn_sac || '',
        quantity: it.quantity,
        unit: it.unit,
        rate: it.rate,
        discount_amount: it.discount_amount,
        tax_rate: it.tax_rate,
        taxable_amount: it.taxable_amount,
        cgst_amount: it.cgst_amount,
        sgst_amount: it.sgst_amount,
        igst_amount: it.igst_amount,
        cess_amount: 0,
        total_amount: it.total_amount,
      }));

      const { data, error } = await supabase.rpc('create_purchase_bill', {
        p_business_id: activeBusiness.id,
        p_bill,
        p_items,
        p_status: status,
      });
      if (error) throw error;
      const result = data as unknown as { bill_id?: string }[] | { bill_id?: string } | null;
      const billId = Array.isArray(result) ? result[0]?.bill_id : result?.bill_id;
      return { billId: billId || '', status };
    },
    onSuccess: ({ status }) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['payables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales-purchases-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast(status === 'draft' ? 'Draft saved — confirm it from the bills list' : 'Purchase bill confirmed successfully', 'success');
      navigate('/app/purchase-bills');
    },
    onError: (err: any) => toast(err.message || 'Failed to save', 'error'),
    onSettled: () => setSaving(false),
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader title="New Purchase Bill" actions={<Button variant="secondary" onClick={() => navigate('/app/purchase-bills')}><ArrowLeft className="h-4 w-4" /> Back</Button>} />

      <div className="card p-6">
        <FormSection title="Party & Dates" description="Who you're buying from and when payment is due">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label">Supplier <span className="text-error-500">*</span></label>
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select supplier...</option>
                {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Bill Number</label>
              <Input value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Auto — enter to override" />
            </div>
            <div>
              <label className="label">Bill Date</label>
              <DatePicker value={billDate} onChange={setBillDate} />
            </div>
            <div>
              <label className="label">Due Date</label>
              <DatePicker value={dueDate} onChange={setDueDate} />
            </div>
          </div>
          {isInterState && (
            <div className="mt-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 text-sm">
              Inter-state transaction detected — IGST will be applied instead of CGST + SGST.
            </div>
          )}
        </FormSection>

        <FormSection
          title="Line Items"
          description="Products or services received"
          actions={
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
              <Plus className="h-4 w-4" /> Add Item
            </button>
          }
        >
          <div className="overflow-x-auto scrollbar-thin -mx-2">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-2 py-2 font-medium w-2/5">Product</th>
                  <th className="text-right px-2 py-2 font-medium">Qty</th>
                  <th className="text-right px-2 py-2 font-medium">Rate</th>
                  <th className="text-right px-2 py-2 font-medium hidden md:table-cell">Disc</th>
                  <th className="text-right px-2 py-2 font-medium">Tax %</th>
                  <th className="text-right px-2 py-2 font-medium">Amount</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-secondary-100 dark:border-secondary-800/50">
                    <td className="px-2 py-2 relative">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-secondary-400 pointer-events-none" />
                        <Input
                          placeholder="Type to search products…"
                          value={item.product_name || (searchIdx === idx ? productSearch : '')}
                          onChange={(e) => {
                            setSearchIdx(idx);
                            setProductSearch(e.target.value);
                            updateItem(idx, { product_id: null, product_name: e.target.value });
                          }}
                          onFocus={() => setSearchIdx(idx)}
                          className="w-full pl-8"
                        />
                      </div>
                      {searchIdx === idx && productSearch && products && (
                        <div className="absolute z-20 mt-1 w-full card-solid max-h-48 overflow-y-auto scrollbar-thin p-1 shadow-lg">
                          {products.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8).map((p) => (
                            <button key={p.id} onClick={() => selectProduct(idx, p)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/30 text-left">
                              <div>
                                <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{p.name}</p>
                                <p className="text-xs text-secondary-400">{p.hsn_sac || 'No HSN'} • Stock: {p.current_stock}</p>
                              </div>
                              <span className="figure text-xs text-primary-600 dark:text-primary-400">{formatCurrency(p.purchase_price, sym)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2"><Input type="number" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })} className="w-20 text-right figure" /></td>
                    <td className="px-2 py-2"><Input type="number" value={item.rate} onChange={(e) => updateItem(idx, { rate: parseFloat(e.target.value) || 0 })} className="w-24 text-right figure" /></td>
                    <td className="px-2 py-2 hidden md:table-cell"><Input type="number" value={item.discount_amount} onChange={(e) => updateItem(idx, { discount_amount: parseFloat(e.target.value) || 0 })} className="w-20 text-right figure" /></td>
                    <td className="px-2 py-2"><Input type="number" value={item.tax_rate} onChange={(e) => updateItem(idx, { tax_rate: parseFloat(e.target.value) || 0 })} className="w-16 text-right figure" /></td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100 figure">{formatCurrency(item.total_amount, sym)}</td>
                    <td className="px-2 py-2">
                      <button onClick={() => removeItem(idx)} className="p-1 text-secondary-400 hover:text-error-600 transition-colors" title="Remove row">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>

        <FormSection title="Notes">
          <textarea className="input resize-none max-w-xl" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes for this bill..." />
        </FormSection>

        <FormSection title="Totals & GST">
          <div className="w-full sm:w-80 ml-auto space-y-2">
            <div className="flex justify-between text-sm"><span className="text-secondary-500">Subtotal</span><span className="figure">{formatCurrency(totals.subtotal, sym)}</span></div>
            {totals.totalDiscount > 0 && <div className="flex justify-between text-sm"><span className="text-secondary-500">Discount</span><span className="figure text-error-600 dark:text-error-400">-{formatCurrency(totals.totalDiscount, sym)}</span></div>}
            <div className="flex justify-between text-sm"><span className="text-secondary-500">Taxable Amount</span><span className="figure">{formatCurrency(totals.taxableAmount, sym)}</span></div>
            {isInterState ? (
              <div className="flex justify-between text-sm"><span className="text-secondary-500">IGST</span><span className="figure">{formatCurrency(totals.igst, sym)}</span></div>
            ) : (
              <>
                <div className="flex justify-between text-sm"><span className="text-secondary-500">CGST</span><span className="figure">{formatCurrency(totals.cgst, sym)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-secondary-500">SGST</span><span className="figure">{formatCurrency(totals.sgst, sym)}</span></div>
              </>
            )}
            {totals.roundOff !== 0 && <div className="flex justify-between text-sm"><span className="text-secondary-500">Round Off</span><span className="figure">{formatCurrency(totals.roundOff, sym)}</span></div>}
            <div className="border-t border-secondary-200 dark:border-secondary-800 pt-2 flex justify-between items-baseline">
              <span className="text-base font-semibold">Grand Total</span>
              <span className="figure text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(totals.grandTotal, sym)}</span>
            </div>
          </div>
        </FormSection>
      </div>

      {/* Sticky action footer — secondary left, primary right */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/purchase-bills')}>Cancel</Button>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => saveMutation.mutate('draft')} loading={saving}>Save as draft</Button>
            <Button onClick={() => saveMutation.mutate('confirmed')} loading={saving}>
              <Save className="h-4 w-4" /> Confirm Purchase
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
