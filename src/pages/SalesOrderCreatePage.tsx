import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Save } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { calculateGstAmounts } from '@/lib/accounting';
import type { Customer, Product } from '@/types/db';

type LineItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  tax_rate: number;
};

const emptyLine: LineItem = { product_id: null, product_name: '', quantity: 1, rate: 0, tax_rate: 18 };

export function SalesOrderCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(todayDateString());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...emptyLine }]);

  const { data: customers } = useQuery({
    queryKey: ['customers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('customers').select('*').eq('business_id', activeBusiness.id).eq('status', 'active').order('name');
      return data as Customer[];
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
    if (!activeBusiness || !customerId) return false;
    const c = customers?.find((x) => x.id === customerId);
    return !!(c?.state && activeBusiness.state && c.state !== activeBusiness.state);
  }, [activeBusiness, customers, customerId]);

  const updateLine = (idx: number, updates: Partial<LineItem>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...updates } : l)));
  };

  const totals = useMemo(() => {
    let taxableAmount = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      if (!l.product_name.trim() || l.quantity <= 0) continue;
      const taxable = roundTo2(l.quantity * l.rate);
      const gst = calculateGstAmounts(taxable, l.tax_rate, isInterState);
      taxableAmount += taxable;
      cgst += gst.cgst_amount;
      sgst += gst.sgst_amount;
      igst += gst.igst_amount;
    }
    const grandTotal = roundTo2(roundTo2(taxableAmount) + roundTo2(cgst + sgst + igst));
    return { taxableAmount: roundTo2(taxableAmount), cgst: roundTo2(cgst), sgst: roundTo2(sgst), igst: roundTo2(igst), grandTotal };
  }, [lines, isInterState]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');
      const validLines = lines.filter((l) => l.product_name.trim() && l.quantity > 0);
      if (!validLines.length) throw new Error('Add at least one line with a description and quantity');
      const { data: userData } = await supabase.auth.getUser();
      const { data: number, error: numberError } = await supabase.rpc('next_document_number', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'sales_order',
        p_date: orderDate,
      });
      if (numberError) throw numberError;

      const { data: order, error } = await supabase.from('sales_orders').insert({
        business_id: activeBusiness.id,
        order_number: String(number),
        customer_id: customerId,
        order_date: orderDate,
        expected_date: expectedDate || null,
        subtotal: totals.taxableAmount,
        discount_amount: 0,
        taxable_amount: totals.taxableAmount,
        cgst_amount: totals.cgst,
        sgst_amount: totals.sgst,
        igst_amount: totals.igst,
        cess_amount: 0,
        round_off: 0,
        grand_total: totals.grandTotal,
        status: 'draft',
        notes: notes || null,
        created_by: userData.user?.id,
      }).select('id').single();
      if (error) throw error;

      const { error: itemsError } = await supabase.from('sales_order_items').insert(
        validLines.map((l) => {
          const taxable = roundTo2(l.quantity * l.rate);
          const gst = calculateGstAmounts(taxable, l.tax_rate, isInterState);
          return {
            business_id: activeBusiness.id,
            sales_order_id: order.id,
            product_id: l.product_id,
            product_name: l.product_name.trim(),
            hsn_sac: null,
            quantity: l.quantity,
            unit: 'PCS',
            rate: l.rate,
            tax_rate: l.tax_rate,
            taxable_amount: taxable,
            total_amount: roundTo2(taxable + gst.total_tax),
          };
        })
      );
      if (itemsError) {
        await supabase.from('sales_orders').delete().eq('id', order.id);
        throw itemsError;
      }
      return order.id;
    },
    onSuccess: () => {
      ['sales-orders', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast('Sales order draft saved', 'success');
      navigate('/app/sales-orders');
    },
    onError: (err: any) => toast(err.message || 'Failed to save sales order', 'error'),
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title="New Sales Order"
        actions={<Button variant="secondary" onClick={() => navigate('/app/sales-orders')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Party & Dates">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Customer" required>
              <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer...</option>
                {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Order Date" required><DatePicker value={orderDate} onChange={setOrderDate} /></FormField>
            <FormField label="Expected Delivery"><DatePicker value={expectedDate} onChange={setExpectedDate} /></FormField>
          </div>
          {isInterState && (
            <div className="mt-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 text-sm">
              Inter-state transaction detected — IGST will be applied instead of CGST + SGST.
            </div>
          )}
        </FormSection>

        <FormSection
          title="Lines"
          description="Pick a product to autofill rate and tax"
          actions={
            <button onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">+ Add line</button>
          }
        >
          <div className="border border-secondary-200 dark:border-secondary-800 rounded-lg divide-y divide-secondary-100 dark:divide-secondary-800/50">
            {lines.map((l, idx) => (
              <div key={idx} className="p-3 space-y-2">
                <Input placeholder="Product / description" value={l.product_name}
                  onChange={(e) => updateLine(idx, { product_name: e.target.value })} />
                <div className="grid grid-cols-[1fr_5rem_5rem_5rem_2rem] gap-2 items-center">
                  <select className="input text-xs" value={l.product_id ?? ''}
                    onChange={(e) => {
                      const p = products?.find((pr) => pr.id === e.target.value);
                      if (p) updateLine(idx, { product_id: p.id, product_name: p.name, rate: p.selling_price, tax_rate: p.tax_rate });
                      else updateLine(idx, { product_id: null });
                    }}>
                    <option value="">Custom line…</option>
                    {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <Input type="number" min={0} value={String(l.quantity)} onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })} className="text-right figure" title="Qty" />
                  <Input type="number" min={0} value={String(l.rate)} onChange={(e) => updateLine(idx, { rate: parseFloat(e.target.value) || 0 })} className="text-right figure" title="Rate" />
                  <Input type="number" min={0} max={28} value={String(l.tax_rate)} onChange={(e) => updateLine(idx, { tax_rate: parseFloat(e.target.value) || 0 })} className="text-right figure" title="Tax %" />
                  <button onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))}
                    className="text-xs text-secondary-400 hover:text-error-600" title="Remove line">×</button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-secondary-400 mt-3">Numbered via the document service on save. Orders have no stock impact until fulfilled.</p>
        </FormSection>

        <FormSection title="Notes & Totals">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-1">
              <FormField label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery expectations, special instructions..." /></FormField>
            </div>
            {totals.grandTotal > 0 && (
              <div className="w-full sm:w-72 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-secondary-500">Taxable</span><span className="figure">{formatCurrency(totals.taxableAmount, sym)}</span></div>
                <div className="flex justify-between"><span className="text-secondary-500">CGST</span><span className="figure">{formatCurrency(totals.cgst, sym)}</span></div>
                <div className="flex justify-between"><span className="text-secondary-500">SGST</span><span className="figure">{formatCurrency(totals.sgst, sym)}</span></div>
                {totals.igst > 0 && <div className="flex justify-between"><span className="text-secondary-500">IGST</span><span className="figure">{formatCurrency(totals.igst, sym)}</span></div>}
                <div className="flex justify-between font-semibold border-t border-secondary-200 dark:border-secondary-700 pt-1 mt-1"><span>Total</span><span className="figure text-primary-600 dark:text-primary-400">{formatCurrency(totals.grandTotal, sym)}</span></div>
              </div>
            )}
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/sales-orders')}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            <Save className="h-4 w-4" /> Save Draft
          </Button>
        </div>
      </div>
    </div>
  );
}
