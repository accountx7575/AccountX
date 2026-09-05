import { useState, useMemo, useRef, type KeyboardEvent } from 'react';
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
import { Plus, Trash2, Search, Save, ArrowLeft, Printer, FileText, FileSpreadsheet, Rocket, Loader2 } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { computeDocLine } from '@/lib/payloads';
import { InvoiceSheet, type InvoiceWithCustomer } from '@/components/invoice/InvoiceSheet';
import { Modal } from '@/components/ui/Modal';
import { useSubscriptionQuota } from '@/hooks/useSubscriptionQuota';
import { printInvoice, exportPdfFromElement, exportInvoiceExcel } from '@/lib/invoiceExport';
import type { Customer, Product, SalesInvoiceItem } from '@/types/db';

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

const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];

export function SalesInvoiceCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayDateString());
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyItem }]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [searchIdx, setSearchIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const quota = useSubscriptionQuota(activeBusiness?.id);

  const handleGuardedSave = (status: 'issued' | 'draft') => {
    // Free-tier quota sentinel: show the upgrade modal instead of letting the
    // save fail with an unhandled database error.
    if (quota.exceeded) {
      setQuotaModalOpen(true);
      return;
    }
    saveMutation.mutate(status);
  };

  const productNameRefs = useRef<(HTMLInputElement | null)[]>([]);

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

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p) =>
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.sku?.toLowerCase().includes(productSearch.toLowerCase())
    );
  }, [products, productSearch]);

  const selectedCustomer = useMemo(
    () => customers?.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );

  const isInterState = useMemo(() => {
    if (!activeBusiness) return false;
    return !!(selectedCustomer && selectedCustomer.state && selectedCustomer.state !== activeBusiness.state);
  }, [activeBusiness, selectedCustomer]);

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
    const grandBeforeRound = roundTo2(taxableAmount + totalTax);
    const roundOff = roundTo2(Math.round(grandBeforeRound) - grandBeforeRound);
    const grandTotal = roundTo2(grandBeforeRound + roundOff);

    return { subtotal, totalDiscount, taxableAmount, cgst: roundTo2(cgst), sgst: roundTo2(sgst), igst: roundTo2(igst), roundOff, grandTotal };
  }, [items, isInterState]);

  const updateItem = (idx: number, updates: Partial<LineItem>) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, ...updates };
      const line = computeDocLine({
        quantity: updated.quantity,
        rate: updated.rate,
        discount_amount: updated.discount_amount,
        tax_rate: updated.tax_rate,
        isInterState,
      });
      updated.taxable_amount = line.taxable_amount;
      updated.cgst_amount = line.cgst_amount;
      updated.sgst_amount = line.sgst_amount;
      updated.igst_amount = line.igst_amount;
      updated.total_amount = line.total_amount;
      return updated;
    }));
  };

  const selectProduct = (idx: number, product: Product) => {
    updateItem(idx, {
      product_id: product.id,
      product_name: product.name,
      hsn_sac: product.hsn_sac || '',
      unit: product.unit,
      rate: product.selling_price,
      tax_rate: product.tax_rate,
    });
    setSearchIdx(null);
    setProductSearch('');
  };

  const addItem = () => {
    setItems((prev) => [...prev, { ...emptyItem }]);
    requestAnimationFrame(() => {
      productNameRefs.current[items.length]?.focus();
    });
  };
  const removeItem = (idx: number) => setItems((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const handleRowKeyDown = (e: KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      productNameRefs.current[idx + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      productNameRefs.current[idx - 1]?.focus();
    }
  };

  const handleProductInputKeyDown = (e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchIdx === idx && productSearch && filteredProducts.length > 0) {
        selectProduct(idx, filteredProducts[0]);
        requestAnimationFrame(() => {
          const qtyInput = (productNameRefs.current[idx]?.closest('tr'))?.querySelector<HTMLInputElement>('input[type="number"]');
          qtyInput?.focus();
        });
      }
    } else if (e.key === 'Escape') {
      setSearchIdx(null);
      setProductSearch('');
    } else {
      handleRowKeyDown(e, idx);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (status: 'issued' | 'draft' = 'issued') => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');
      if (items.some((it) => !it.product_name || it.quantity <= 0)) throw new Error('Please fill all item details');

      setSaving(true);

      const p_invoice = {
        customer_id: customerId,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        place_of_supply: selectedCustomer?.state || activeBusiness.state,
        subtotal: totals.subtotal,
        discount_amount: totals.totalDiscount,
        taxable_amount: totals.taxableAmount,
        cgst_amount: totals.cgst,
        sgst_amount: totals.sgst,
        igst_amount: totals.igst,
        cess_amount: 0,
        round_off: totals.roundOff,
        grand_total: totals.grandTotal,
        payment_method: paymentMethod || null,
        notes: notes || null,
        terms: terms || null,
      };

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

      const { data, error } = await supabase.rpc('create_sales_invoice', {
        p_business_id: activeBusiness.id,
        p_invoice,
        p_items,
        p_status: status,
      });
      if (error) throw error;

      const result = data as unknown as { invoice_id?: string }[] | { invoice_id?: string } | null;
      const invoiceId = Array.isArray(result) ? result[0]?.invoice_id : result?.invoice_id;
      return { invoiceId: invoiceId || '', status };
    },
    onSuccess: ({ invoiceId, status }) => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['receivables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales-purchases-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast(status === 'draft' ? 'Draft saved — issue it from the invoices list' : 'Invoice issued successfully', 'success');
      navigate(status === 'draft' ? '/app/sales-invoices' : invoiceId ? `/app/sales-invoices/${invoiceId}` : '/app/sales-invoices');
    },
    onError: (err: any) => toast(err.message || 'Failed to save invoice', 'error'),
    onSettled: () => setSaving(false),
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  // Live A4 preview model built from current form state
  const previewItems: SalesInvoiceItem[] = items
    .filter((it) => it.product_name.trim() !== '')
    .map((it, i) => ({
      id: `preview-${i}`,
      business_id: '',
      invoice_id: '',
      product_id: it.product_id,
      product_name: it.product_name,
      hsn_sac: it.hsn_sac || null,
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
      created_at: '',
    }));

  const previewInvoice = {
    id: 'preview',
    business_id: activeBusiness?.id || '',
    customer_id: customerId,
    invoice_number: `${activeBusiness?.invoice_prefix || 'INV'}/…/PREVIEW`,
    invoice_date: invoiceDate,
    due_date: dueDate || null,
    place_of_supply: selectedCustomer?.state || activeBusiness?.state || null,
    subtotal: totals.subtotal,
    discount_amount: totals.totalDiscount,
    taxable_amount: totals.taxableAmount,
    cgst_amount: totals.cgst,
    sgst_amount: totals.sgst,
    igst_amount: totals.igst,
    cess_amount: 0,
    round_off: totals.roundOff,
    grand_total: totals.grandTotal,
    paid_amount: 0,
    balance_amount: totals.grandTotal,
    payment_status: 'unpaid' as const,
    status: 'draft' as const,
    payment_method: paymentMethod || null,
    notes: notes || null,
    terms: terms || null,
    created_by: null,
    created_at: '',
    updated_at: '',
    customer: selectedCustomer,
  } as unknown as InvoiceWithCustomer;

  const taxRateOptions = useMemo(() => {
    const used = new Set<number>(GST_SLABS);
    items.forEach((it) => used.add(Number(it.tax_rate)));
    return Array.from(used).sort((a, b) => a - b);
  }, [items]);

  const totalRows = (
    <div className="w-full sm:w-80 ml-auto space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-secondary-500">Subtotal</span>
        <span className="figure">{formatCurrency(totals.subtotal, sym)}</span>
      </div>
      {totals.totalDiscount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-secondary-500">Discount</span>
          <span className="figure text-error-600 dark:text-error-400">-{formatCurrency(totals.totalDiscount, sym)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span className="text-secondary-500">Taxable Amount</span>
        <span className="figure">{formatCurrency(totals.taxableAmount, sym)}</span>
      </div>
      {isInterState ? (
        <div className="flex justify-between text-sm">
          <span className="text-secondary-500">IGST</span>
          <span className="figure">{formatCurrency(totals.igst, sym)}</span>
        </div>
      ) : (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-secondary-500">CGST</span>
            <span className="figure">{formatCurrency(totals.cgst, sym)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-secondary-500">SGST</span>
            <span className="figure">{formatCurrency(totals.sgst, sym)}</span>
          </div>
        </>
      )}
      {totals.roundOff !== 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-secondary-500">Round Off</span>
          <span className="figure">{formatCurrency(totals.roundOff, sym)}</span>
        </div>
      )}
      <div className="border-t border-secondary-200 dark:border-secondary-800 pt-2 flex justify-between items-baseline">
        <span className="text-base font-semibold">Grand Total</span>
        <span className="figure text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(totals.grandTotal, sym)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="New Sale Invoice"
        actions={
          <Button variant="secondary" onClick={() => navigate('/app/sales-invoices')}><ArrowLeft className="h-4 w-4" /> Back</Button>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT: entry form (wider editor proportion) */}
        <div className="card p-6 min-w-0 xl:col-span-8">
          <FormSection title="Party & Dates" description="Who you're billing and when payment is due">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label">Customer <span className="text-error-500">*</span></label>
                <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select customer...</option>
                  {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Invoice Date</label>
                <DatePicker value={invoiceDate} onChange={setInvoiceDate} />
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
            description="Type to search products · ⌘ picks first match"
            actions={
              <button type="button" onClick={addItem} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
                <Plus className="h-4 w-4" /> Add Item
              </button>
            }
          >
            <div className="overflow-x-auto scrollbar-thin -mx-2">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                    <th className="text-left px-2 py-2 font-medium w-2/5">Product</th>
                    <th className="text-right px-2 py-2 font-medium">Qty</th>
                    <th className="text-right px-2 py-2 font-medium">Rate</th>
                    <th className="text-right px-2 py-2 font-medium">Disc</th>
                    <th className="text-left px-2 py-2 font-medium">Tax %</th>
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
                            ref={(el) => { productNameRefs.current[idx] = el; }}
                            placeholder="Type to search… ⌘"
                            value={item.product_name || (searchIdx === idx ? productSearch : '')}
                            onChange={(e) => {
                              setSearchIdx(idx);
                              setProductSearch(e.target.value);
                              if (!e.target.value) {
                                updateItem(idx, { product_id: null, product_name: '', hsn_sac: '', rate: 0, tax_rate: 0 });
                              } else {
                                updateItem(idx, { product_name: e.target.value });
                              }
                            }}
                            onFocus={() => setSearchIdx(idx)}
                            onBlur={() => setTimeout(() => setSearchIdx((cur) => (cur === idx ? null : cur)), 150)}
                            onKeyDown={(e) => handleProductInputKeyDown(e, idx)}
                            className="w-full pl-8"
                          />
                        </div>
                        {searchIdx === idx && productSearch && filteredProducts.length > 0 && (
                          <div className="absolute z-20 mt-1 w-full card-solid max-h-48 overflow-y-auto scrollbar-thin p-1 shadow-lg">
                            {filteredProducts.slice(0, 8).map((p) => (
                              <button
                                key={p.id}
                                onMouseDown={() => selectProduct(idx, p)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/30 text-left"
                              >
                                <div>
                                  <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100">{p.name}</p>
                                  <p className="text-xs text-secondary-400">{p.hsn_sac || 'No HSN'} • Stock: {p.current_stock}</p>
                                </div>
                                <span className="figure text-xs text-primary-600 dark:text-primary-400">{formatCurrency(p.selling_price, sym)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleRowKeyDown(e, idx)} className="w-20 text-right figure" />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.rate} onChange={(e) => updateItem(idx, { rate: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleRowKeyDown(e, idx)} className="w-24 text-right figure" />
                      </td>
                      <td className="px-2 py-2">
                        <Input type="number" value={item.discount_amount} onChange={(e) => updateItem(idx, { discount_amount: parseFloat(e.target.value) || 0 })} onKeyDown={(e) => handleRowKeyDown(e, idx)} className="w-20 text-right figure" />
                        {roundTo2(item.quantity * item.rate - item.discount_amount) > 0 && (
                          <p className="figure text-[10px] text-secondary-400 mt-1 text-right pr-1">{formatCurrency(roundTo2(item.quantity * item.rate - item.discount_amount), sym)}</p>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className="input w-20 px-1.5 py-1.5 text-xs"
                          value={String(item.tax_rate)}
                          onChange={(e) => updateItem(idx, { tax_rate: parseFloat(e.target.value) })}
                          onKeyDown={(e) => handleRowKeyDown(e, idx)}
                        >
                          {taxRateOptions.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium text-secondary-900 dark:text-secondary-100 figure">
                        {formatCurrency(item.total_amount, sym)}
                      </td>
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
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-secondary-400">
              <span><kbd className="kbd">↑↓</kbd> row nav</span>
              <span><kbd className="kbd">⌘</kbd> pick first match</span>
              <span><kbd className="kbd">Esc</kbd> close suggestions</span>
            </div>
          </FormSection>

          <FormSection title="Payment, Notes & Terms">
            <div className="space-y-4">
              <div className="max-w-48">
                <label className="label">Payment Method</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="">—</option>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank</option>
                  <option value="card">Card</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input resize-none" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." />
              </div>
              <div>
                <label className="label">Terms &amp; Conditions</label>
                <textarea className="input resize-none" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms and conditions..." />
              </div>
            </div>
          </FormSection>

          <FormSection title="Totals & GST">
            {totalRows}
          </FormSection>
        </div>

        {/* RIGHT: live A4 sheet preview (compact proportion) */}
        <div className="min-w-0 xl:col-span-4">
          <div className="xl:sticky xl:top-20">
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="badge bg-primary-600 text-white">LIVE PREVIEW</span>
              <span className="text-xs text-secondary-400">Updates as you type · A4 GST layout</span>
            </div>
            <div id="invoice-print-area" className="max-h-none xl:max-h-[calc(100vh-11rem)] overflow-visible xl:overflow-y-auto scrollbar-thin rounded-xl print:max-h-none print:overflow-visible print:border-0 print:shadow-none print:rounded-none">
              <div className="origin-top scale-[0.85] xl:scale-[0.75] pb-[15%] print:origin-top-left print:scale-100 print:pb-0">
                <InvoiceSheet
                  business={activeBusiness}
                  invoice={previewInvoice}
                  items={previewItems.length > 0 ? previewItems : []}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky action footer — secondary left, primary right */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md print:hidden">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate('/app/sales-invoices')}>Cancel</Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-10" onClick={printInvoice} title="Print this invoice (A4)">
              <Printer className="h-4 w-4" /> Print Invoice
            </Button>
            <Button
              variant="secondary"
              className="h-10"
              onClick={async () => {
                try {
                  await exportPdfFromElement(document.getElementById('invoice-print-area'), previewInvoice.invoice_number, selectedCustomer?.company_name || selectedCustomer?.name);
                  toast('PDF exported', 'success');
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to export PDF', 'error');
                }
              }}
            >
              <FileText className="h-4 w-4" /> Save as PDF
            </Button>
            <Button
              variant="secondary"
              className="h-10"
              onClick={() => {
                try {
                  exportInvoiceExcel(activeBusiness, previewInvoice as InvoiceWithCustomer, previewItems);
                  toast('Excel (.csv) exported', 'success');
                } catch (err) {
                  toast(err instanceof Error ? err.message : 'Failed to export Excel', 'error');
                }
              }}
            >
              <FileSpreadsheet className="h-4 w-4" /> Export to Excel
            </Button>
            <Button variant="secondary" className="h-10" onClick={() => handleGuardedSave('draft')} loading={saving}>
              <Save className="h-4 w-4" /> Save as draft
            </Button>
            <button
              onClick={() => handleGuardedSave('issued')}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 h-10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Save &amp; Issue
            </button>
          </div>
        </div>
      </div>
      <Modal
        open={quotaModalOpen}
        onClose={() => setQuotaModalOpen(false)}
        title="Monthly invoice limit reached"
        size="sm"
      >
        <p className="text-sm text-secondary-600 dark:text-secondary-300">
          Your Free plan allows {quota.limit} invoices per month. You have used{' '}
          {quota.used} this month. Upgrade your subscription to keep creating
          invoices.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setQuotaModalOpen(false)}>
            Close
          </Button>
          <Button onClick={() => { setQuotaModalOpen(false); navigate('/app/settings'); }}>
            Upgrade plan
          </Button>
        </div>
      </Modal>
    </div>
  );
}
