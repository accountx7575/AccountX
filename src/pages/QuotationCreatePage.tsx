import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { allocateDocumentNumber } from '@/lib/numbering';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Save, X } from 'lucide-react';
import { formatCurrency, roundTo2 } from '@/lib/utils';
import { calculateGstAmounts } from '@/lib/accounting';
import { saveDemoDoc, defaultDemoNumber, countDemoDocs } from '@/lib/demoStore';
import type { Customer, Product, Quotation, QuotationItem } from '@/types/db';

function getLocalTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalNowTime(): string {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

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

export function QuotationCreatePage({ demo = false }: { demo?: boolean } = {}) {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);

  const [customerId, setCustomerId] = useState('');
  const [quoteDate, setQuoteDate] = useState(getLocalTodayDate());
  const [quoteTime, setQuoteTime] = useState(getLocalNowTime());
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
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

  const { data: existingQuote } = useQuery({
    queryKey: ['quotation', activeBusiness?.id, editId],
    queryFn: async () => {
      if (!activeBusiness || !editId) return null;
      const { data: quote, error: qErr } = await supabase
        .from('quotations')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('id', editId)
        .single();
      if (qErr) throw qErr;

      const { data: items, error: iErr } = await supabase
        .from('quotation_items')
        .select('*')
        .eq('quotation_id', editId);
      if (iErr) throw iErr;

      return { quote: quote as Quotation, items: (items || []) as QuotationItem[] };
    },
    enabled: isEdit && !!activeBusiness && !!editId,
  });

  useEffect(() => {
    if (!existingQuote) return;
    const { quote, items } = existingQuote;
    setCustomerId(quote.customer_id);
    setQuoteDate(quote.quote_date);
    if (quote.created_at) {
      setQuoteTime(
        new Date(quote.created_at).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      );
    }
    setExpiryDate(quote.expiry_date || '');
    setNotes(quote.notes || quote.terms || '');

    if (items.length > 0) {
      setLines(
        items.map((it) => ({
          product_id: it.product_id || null,
          product_name: it.product_name,
          hsn_sac: it.hsn_sac || '',
          quantity: Number(it.quantity) || 1,
          unit: it.unit || 'PCS',
          rate: Number(it.rate) || 0,
          tax_rate: Number(it.tax_rate) || 18,
          tax_amount: 0,
          total: Number(it.total_amount) || 0,
        }))
      );
    }
  }, [existingQuote]);

  const isInterState = useMemo(() => {
    if (!activeBusiness || !customerId) return false;
    const c = customers?.find((x) => x.id === customerId);
    return !!(c?.state && activeBusiness.state && c.state !== activeBusiness.state);
  }, [activeBusiness, customers, customerId]);

  const updateLine = (idx: number, updates: Partial<LineItem>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...updates } : l)));
  };

  const totals = useMemo(() => {
    let taxableAmount = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');

      const validLines = lines.filter((l) => l.product_name.trim() && l.quantity > 0);
      if (!validLines.length) throw new Error('Add at least one item');

      const chosenCustomer = customers?.find(
        (c) => c.id === customerId || c.name.toLowerCase() === customerId.trim().toLowerCase()
      );
      if (!chosenCustomer?.id) throw new Error('Please select a valid customer');

      // Demo/Proforma sandbox (PBS-112): zero effect on real books — no
      // quotations/quotation_items rows, no counters, no journal, no stock.
      if (demo) {
        const saved = saveDemoDoc(
          activeBusiness.id,
          'quotation',
          {
            quotation_number: defaultDemoNumber('quotation', countDemoDocs(activeBusiness.id, 'quotation') + 1),
            customer_id: chosenCustomer.id,
            quote_date: quoteDate,
            expiry_date: expiryDate || null,
            subtotal: totals.subtotal,
            discount_amount: 0,
            taxable_amount: totals.taxableAmount,
            cgst_amount: totals.cgst,
            sgst_amount: totals.sgst,
            igst_amount: totals.igst,
            round_off: 0,
            grand_total: totals.grandTotal,
            status: 'draft',
            notes: notes.trim() || null,
          },
          validLines.map((l) => ({
            product_id: l.product_id || null,
            product_name: l.product_name,
            hsn_sac: l.hsn_sac || null,
            quantity: Number(l.quantity) || 1,
            unit: l.unit || 'PCS',
            rate: Number(l.rate) || 0,
            tax_rate: Number(l.tax_rate) || 0,
            taxable_amount: roundTo2(Number(l.quantity) * Number(l.rate)),
            total_amount: roundTo2(Number(l.quantity) * Number(l.rate) + calculateGstAmounts(roundTo2(Number(l.quantity) * Number(l.rate)), Number(l.tax_rate) || 0, isInterState).total_tax),
          })),
          chosenCustomer as unknown as Record<string, unknown>
        );
        return saved.id;
      }

      const { data: userData } = await supabase.auth.getUser();

      let targetQuoteId: string | undefined = editId;
      let createdNewQuote = false;

      if (isEdit && targetQuoteId) {
        const { error: updateErr } = await supabase
          .from('quotations')
          .update({
            customer_id: chosenCustomer.id,
            quote_date: quoteDate,
            expiry_date: expiryDate || null,
            subtotal: totals.subtotal,
            taxable_amount: totals.taxableAmount,
            cgst_amount: totals.cgst,
            sgst_amount: totals.sgst,
            igst_amount: totals.igst,
            grand_total: totals.grandTotal,
            notes: notes.trim() || null,
          })
          .eq('id', targetQuoteId)
          .eq('business_id', activeBusiness.id);

        if (updateErr) throw updateErr;

        await supabase.from('quotation_items').delete().eq('quotation_id', targetQuoteId);
      } else {
        // Insert with ONE retry on duplicate key (23505): each attempt
        // re-allocates from a fresh scan of existing numbers, so a stale
        // counter is stepped past (Date.now fallback if the scan itself is
        // unavailable).
        let createdQuote: { id: string } | null = null;
        let insertErr: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          let docNumber = '';
          let counterUnavailable = false;
          try {
            docNumber = await allocateDocumentNumber({
              businessId: activeBusiness.id,
              docType: 'quotation',
              table: 'quotations',
              numberColumn: 'quotation_number',
              date: quoteDate,
            });
          } catch (rpcErr) {
            console.warn('RPC fallback', rpcErr);
            counterUnavailable = true;
          }
          if (!docNumber) docNumber = `QT-${Date.now().toString().slice(-6)}${counterUnavailable ? '' : `-${attempt}`}`;

          const res = await supabase
            .from('quotations')
            .insert({
              business_id: activeBusiness.id,
              quotation_number: docNumber,
              customer_id: chosenCustomer.id,
              quote_date: quoteDate,
              expiry_date: expiryDate || null,
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
              notes: notes.trim() || null,
              created_by: userData?.user?.id || null,
            })
            .select('id')
            .single();

          if (!res.error) {
            createdQuote = res.data;
            break;
          }
          insertErr = res.error;
          if (res.error.code !== '23505') break;
          if (counterUnavailable && attempt === 0) {
            // Counter RPC is down and the timestamp fallback collided — retry
            // gives a fresh Date.now() suffix, which is enough on its own.
            continue;
          }
        }
        if (insertErr || !createdQuote) {
          if (insertErr?.code === '23505') {
            throw new Error('Could not allocate a unique quotation number — please try again');
          }
          throw insertErr;
        }
        targetQuoteId = createdQuote.id;
        createdNewQuote = true;
      }

      const itemsRecord = validLines.map((l) => {
        const quantity = Number(l.quantity) || 1;
        const rate = Number(l.rate) || 0;
        const taxRate = Number(l.tax_rate) || 0;
        const taxable = roundTo2(quantity * rate);
        const gst = calculateGstAmounts(taxable, taxRate, isInterState);
        return {
          business_id: activeBusiness.id,
          quotation_id: targetQuoteId,
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

      const { error: itemsError } = await supabase.from('quotation_items').insert(itemsRecord);
      if (itemsError) {
        // Client rollback: only newly created quotations can be orphaned
        // (an edited parent already existed before this save).
        if (createdNewQuote && targetQuoteId) {
          await supabase.from('quotations').delete().eq('id', targetQuoteId);
        }
        throw itemsError;
      }

      return targetQuoteId;
    },
    onSuccess: (demoId: string) => {
      ['quotations-data', 'quotations', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] })
      );
      if (demo && demoId) {
        toast('Demo quotation saved — sandbox only, books untouched', 'success');
        navigate(`/app/demo/quotations/${demoId}`);
        return;
      }
      toast(isEdit ? 'Quotation updated successfully!' : 'Quotation draft saved successfully!', 'success');
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
        title={isEdit ? 'Edit Quotation' : demo ? 'New Demo Quotation' : 'New Quotation'}
        actions={
          <Button variant="secondary" onClick={() => navigate(demo ? '/app/demo/quotations' : '/app/quotations')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div className="card p-6">
        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <FormField label="Time">
              <Input
                type="text"
                value={quoteTime}
                onChange={(e) => setQuoteTime(e.target.value)}
                placeholder="12:00 PM"
                className="figure"
              />
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

        <FormSection>
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
                    onClick={() =>
                      setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
                    }
                    className="mt-6 p-2 rounded-md text-secondary-500 dark:text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30 transition-colors"
                    title="Remove line"
                    aria-label="Remove line"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            <div className="p-3">
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-secondary-300 dark:border-secondary-700 text-sm font-medium text-primary-600 dark:text-primary-400 hover:border-primary-400 hover:bg-primary-50/60 dark:hover:bg-primary-900/20 transition-colors"
              >
                Add another product
              </button>
            </div>
          </div>
        </FormSection>

        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div>
              <FormField label="Notes">
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Delivery expectations, notes for the customer..."
                />
              </FormField>
            </div>
            {totals.grandTotal > 0 && (
              <div className="w-full md:w-80 md:ml-auto space-y-1 text-sm">
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
          <Button variant="secondary" onClick={() => navigate(demo ? '/app/demo/quotations' : '/app/quotations')}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <Save className="h-4 w-4" /> {demo ? 'Create Demo Draft' : isEdit ? 'Update Quotation' : 'Save Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}