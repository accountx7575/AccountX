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
import { ArrowLeft, Save, X } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { calculateGstAmounts } from '@/lib/accounting';
import type { Customer, Product } from '@/types/db';

type LineItem = {
  product_id: string | null;
  product_name: string;
  hsn_sac: string;
  quantity: number;
  unit: string;
  rate: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
};

const emptyLine: LineItem = {
  product_id: null,
  product_name: '',
  hsn_sac: '',
  quantity: 1,
  unit: 'PCS',
  rate: 0,
  tax_rate: 18,
  tax_amount: 0,
  total: 0,
};

export function QuotationCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [quoteDate, setQuoteDate] = useState(todayDateString());
  const [expiryDate, setExpiryDate] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...emptyLine }]);

  const { data: customers } = useQuery({
    queryKey: ['customers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .order('name');
      return (data || []) as Customer[];
    },
    enabled: !!activeBusiness,
  });

  const { data: products } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'active'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('is_active', true)
        .order('name');
      return (data || []) as Product[];
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
    return {
      subtotal: roundTo2(taxableAmount),
      taxableAmount: roundTo2(taxableAmount),
      cgst: roundTo2(cgst),
      sgst: roundTo2(sgst),
      igst: roundTo2(igst),
      grandTotal,
    };
  }, [lines, isInterState]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');

      const validLines = lines.filter((l) => l.product_name.trim() && l.quantity > 0);
      if (!validLines.length) throw new Error('Add at least one item');

      const chosenCustomer = customers?.find(
        (c) => c.id === customerId || c.name.toLowerCase() === customerId.trim().toLowerCase()
      );

      if (!chosenCustomer?.id) {
        throw new Error('Please select a customer from the dropdown list');
      }

      const { data: userData } = await supabase.auth.getUser();

      let docNumber = `QT-${Date.now().toString().slice(-6)}`;
      try {
        const { data: generated } = await supabase.rpc('next_document_number', {
          p_business_id: activeBusiness.id,
          p_doc_type: 'quotation',
          p_date: quoteDate,
        });
        if (generated) docNumber = String(generated);
      } catch (rpcErr) {
        console.warn('RPC fallback', rpcErr);
      }

      const quotationRecord = {
        business_id: activeBusiness.id,
        quotation_number: docNumber,
        customer_id: chosenCustomer.id,
        quote_date: quoteDate,
        expiry_date: expiryDate ? expiryDate : null,
        subtotal: totals.subtotal,
        discount_amount: 0,
        taxable_amount: totals.taxableAmount,
        cgst_amount: totals.cgst,
        sgst_amount: totals.sgst,
        igst_amount: totals.igst,
        cess_amount: 0,
        round_off: 0,
        grand_total: totals.grandTotal,
        status: 'draft',
        terms: terms.trim() || null,
        notes: terms.trim() || null,
        created_by: userData?.user?.id || null,
      };

      const { data: quote, error: quoteError } = await supabase
        .from('quotations')
        .insert(quotationRecord)
        .select('id')
        .single();

      if (quoteError) {
        throw new Error(quoteError.message || 'Error saving quotation');
      }

      // Exact columns matching quotation_items table schema
      const itemsRecord = validLines.map((l) => {
        const quantity = Number(l.quantity) || 1;
        const rate = Number(l.rate) || 0;
        const taxRate = Number(l.tax_rate) || 0;
        const taxable = roundTo2(quantity * rate);
        const gst = calculateGstAmounts(taxable, taxRate, isInterState);
        return {
          business_id: activeBusiness.id,
          quotation_id: quote.id,
          product_id: l.product_id || null,
          product_name: l.product_name,
          quantity,
          unit: l.unit || 'PCS',
          rate,
          tax_rate: taxRate,
          taxable_amount: taxable,
          total_amount: roundTo2(taxable + gst.total_tax),
        };
      });

      const { error: itemsError } = await supabase
        .from('quotation_items')
        .insert(itemsRecord);

      if (itemsError) {
        await supabase.from('quotations').delete().eq('id', quote.id);
        throw new Error(itemsError.message || 'Error saving items');
      }

      return quote.id;
    },
    onSuccess: () => {
      ['quotations', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      toast('Quotation draft saved successfully!', 'success');
      navigate('/app/quotations');
    },
    onError: (err: any) => {
      toast(err?.message || 'Failed to save quotation', 'error');
    },
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title="New Quotation"
        actions={
          <Button variant="secondary" onClick={() => navigate('/app/quotations')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div className="card p-6">
        <FormSection title="Party & Dates">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Customer" required>
              <select
                className="input"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select customer...</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Quote Date" required>
              <DatePicker value={quoteDate} onChange={setQuoteDate} />
            </FormField>
            <FormField label="Valid Until">
              <DatePicker value={expiryDate} onChange={setExpiryDate} />
            </FormField>
          </div>
          {isInterState && (
            <div className="mt-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 text-sm">
              Inter-state transaction detected — IGST will be applied instead of CGST + SGST.
            </div>
          )}
        </FormSection>

        <FormSection
          title="Lines"
          description="Select a product from the list to autofill rate and tax."
          actions={
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
            >
              + Add line
            </button>
          }
        >
          <div className="border border-secondary-200 dark:border-secondary-800 rounded-lg divide-y divide-secondary-100 dark:divide-secondary-800/50">
            {lines.map((l, idx) => {
              const lineTotal = roundTo2(l.quantity * l.rate);
              return (
                <div key={idx} className="p-3 flex gap-2 items-start flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <FormField label="Product / Description">
                      <select
                        className="input"
                        value={l.product_id || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const p = products?.find((pr) => pr.id === val);
                          if (p) {
                            updateLine(idx, {
                              product_id: p.id,
                              product_name: p.name,
                              hsn_sac: p.hsn_sac || '',
                              unit: p.unit || 'PCS',
                              rate: p.selling_price || 0,
                              tax_rate: p.tax_rate || 0,
                            });
                          } else {
                            updateLine(idx, {
                              product_id: null,
                              product_name: '',
                              hsn_sac: '',
                              unit: 'PCS',
                              rate: 0,
                              tax_rate: 18,
                            });
                          }
                        }}
                      >
                        <option value="">— Select Product —</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                  <FormField label="Qty" className="w-20">
                    <Input
                      type="number"
                      min={1}
                      value={String(l.quantity)}
                      onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                      className="text-right figure"
                    />
                  </FormField>
                  <FormField label="Rate" className="w-28">
                    <Input
                      type="number"
                      min={0}
                      value={String(l.rate)}
                      onChange={(e) => updateLine(idx, { rate: Number(e.target.value) || 0 })}
                      className="text-right figure"
                    />
                  </FormField>
                  <FormField label="Tax %" className="w-20">
                    <Input
                      type="number"
                      min={0}
                      max={28}
                      value={String(l.tax_rate)}
                      onChange={(e) => updateLine(idx, { tax_rate: Number(e.target.value) || 0 })}
                      className="text-right figure"
                    />
                  </FormField>
                  <FormField label="Amount" className="w-32">
                    <div className="input text-right figure bg-secondary-50 dark:bg-secondary-900/60 font-medium">
                      {formatCurrency(lineTotal, sym)}
                    </div>
                  </FormField>
                  <button
                    type="button"
                    onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))}
                    className="mt-6 p-2 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                    title="Remove line"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </FormSection>

        <FormSection title="Terms & Totals">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-1">
              <FormField label="Terms">
                <Textarea
                  rows={2}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Payment terms, validity notes..."
                />
              </FormField>
            </div>
            {totals.grandTotal > 0 && (
              <div className="w-full sm:w-72 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-secondary-500">Taxable</span>
                  <span className="figure">{formatCurrency(totals.taxableAmount, sym)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-500">CGST</span>
                  <span className="figure">{formatCurrency(totals.cgst, sym)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary-500">SGST</span>
                  <span className="figure">{formatCurrency(totals.sgst, sym)}</span>
                </div>
                {totals.igst > 0 && (
                  <div className="flex justify-between">
                    <span className="text-secondary-500">IGST</span>
                    <span className="figure">{formatCurrency(totals.igst, sym)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-secondary-200 dark:border-secondary-700 pt-1 mt-1">
                  <span>Total</span>
                  <span className="figure text-primary-600 dark:text-primary-400">
                    {formatCurrency(totals.grandTotal, sym)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/quotations')}>
            Cancel
          </Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            <Save className="h-4 w-4" /> Save Draft
          </Button>
        </div>
      </div>
    </div>
  );
}