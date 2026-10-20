import { useState, useMemo, useRef, useEffect, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { Plus, Trash2, Save, ArrowLeft, Printer, FileText, FileSpreadsheet, Rocket, Loader2 } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { computeDocLine } from '@/lib/payloads';
import { InvoiceSheet, type InvoiceWithCustomer } from '@/components/invoice/InvoiceSheet';
import { mergeBusinessExtras } from '@/lib/businessExtras';
import { Modal } from '@/components/ui/Modal';
import { useSubscriptionQuota } from '@/hooks/useSubscriptionQuota';
import { printInvoice, exportPdfFromElement, exportInvoiceExcel } from '@/lib/invoiceExport';
import type { Customer, Product, SalesInvoice, SalesInvoiceItem } from '@/types/db';

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
  const { activeBusiness, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);

  const [customerId, setCustomerId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayDateString());
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<LineItem[]>([{ ...emptyItem }]);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const quota = useSubscriptionQuota(activeBusiness?.id);
  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);

  // Edit mode: fetch existing sales invoice + its items and populate form state
  const existingQuery = useQuery({
    queryKey: ['sales-invoice', activeBusiness?.id, editId],
    queryFn: async () => {
      const { data: inv, error: invError } = await supabase
        .from('sales_invoices')
        .select('*')
        .eq('business_id', activeBusiness!.id)
        .eq('id', editId!)
        .single();
      if (invError) throw invError;
      const { data: invItems, error: itemsError } = await supabase
        .from('sales_invoice_items')
        .select('*')
        .eq('invoice_id', editId!)
        .order('created_at');
      if (itemsError) throw itemsError;
      return { invoice: inv as SalesInvoice, items: (invItems || []) as SalesInvoiceItem[] };
    },
    enabled: isEdit && !!activeBusiness,
  });

  useEffect(() => {
    const loaded = existingQuery.data;
    if (!loaded) return;
    const { invoice: inv, items: loadedItems } = loaded;
    setCustomerId(inv.customer_id);
    setInvoiceNumber(inv.invoice_number);
    setInvoiceDate(inv.invoice_date);
    setDueDate(inv.due_date || '');
    setNotes(inv.notes || '');
    setPaymentMethod(inv.payment_method || '');
    if (loadedItems.length > 0) {
      setItems(loadedItems.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        hsn_sac: it.hsn_sac || '',
        quantity: Number(it.quantity),
        unit: it.unit || 'PCS',
        rate: Number(it.rate),
        discount_amount: Number(it.discount_amount || 0),
        tax_rate: Number(it.tax_rate),
        taxable_amount: Number(it.taxable_amount),
        cgst_amount: Number(it.cgst_amount),
        sgst_amount: Number(it.sgst_amount),
        igst_amount: Number(it.igst_amount),
        total_amount: Number(it.total_amount),
      })));
    }
  }, [existingQuery.data]);

  const handleGuardedSave = (status: 'issued' | 'draft') => {
    // Maintenance sentinel: read-only mode for regular tenants. Super-admin
    // access (including impersonation support) stays active.
    let maintenanceOn = false;
    try {
      maintenanceOn = localStorage.getItem('accountx_maintenance_mode') === 'true';
    } catch {
      maintenanceOn = false;
    }
    if (maintenanceOn && !isSuperAdmin) {
      setMaintenanceModalOpen(true);
      return;
    }
    // Free-tier quota sentinel: show the upgrade modal instead of letting the
    // save fail with an unhandled database error (new invoices only).
    if (!isEdit && quota.exceeded) {
      setQuotaModalOpen(true);
      return;
    }
    saveMutation.mutate(status);
  };

  const rowRefs = useRef<(HTMLSelectElement | null)[]>([]);

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
    setItems((prev) => {
      const next = [...prev];
      const cur = { ...next[idx], ...updates };

      const computed = computeDocLine({
        quantity: cur.quantity,
        rate: cur.rate,
        discount_amount: cur.discount_amount,
        tax_rate: cur.tax_rate,
        isInterState,
      });

      next[idx] = {
        ...cur,
        taxable_amount: computed.taxable_amount,
        cgst_amount: computed.cgst_amount,
        sgst_amount: computed.sgst_amount,
        igst_amount: computed.igst_amount,
        total_amount: computed.total_amount,
      };
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { ...emptyItem }]);
    setTimeout(() => {
      const last = rowRefs.current[items.length];
      last?.focus();
    }, 50);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => {
      if (prev.length <= 1) {
        return [{ ...emptyItem }];
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLSelectElement>, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === items.length - 1) {
      if (items[idx].product_id) {
        e.preventDefault();
        addItem();
      }
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (status: 'issued' | 'draft') => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');
      if (items.some((it) => !it.product_name || it.quantity <= 0)) {
        throw new Error('Please fill in all item details');
      }

      setSaving(true);

      // Edit mode: UPDATE existing sales invoice header and replace line items
      if (isEdit) {
        const loaded = existingQuery.data;
        if (!loaded) throw new Error('Invoice not loaded yet');
        const biz = activeBusiness.id;
        const newBalance = Math.max(0, totals.grandTotal - Number(loaded.invoice.paid_amount || 0));
        const paymentStatus = newBalance <= 0 ? 'paid' : Number(loaded.invoice.paid_amount || 0) > 0 ? 'partially_paid' : 'unpaid';

        const { error: headerError } = await supabase
          .from('sales_invoices')
          .update({
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
            balance_amount: newBalance,
            payment_status: paymentStatus,
            payment_method: paymentMethod || null,
            notes: notes || null,
          })
          .eq('business_id', biz)
          .eq('id', editId!);
        if (headerError) throw headerError;

        const { error: clearError } = await supabase
          .from('sales_invoice_items')
          .delete()
          .eq('invoice_id', editId!);
        if (clearError) throw clearError;

        const rows = items.map((it) => ({
          invoice_id: editId!,
          product_id: it.product_id,
          product_name: it.product_name,
          hsn_sac: it.hsn_sac || '',
          quantity: it.quantity,
          unit: it.unit || 'PCS',
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
        const { error: itemsError } = await supabase
          .from('sales_invoice_items')
          .insert(rows);
        if (itemsError) throw itemsError;

        return { invoiceId: editId!, status: loaded.invoice.status, edited: true };
      }

      // Create mode
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
      return { invoiceId: invoiceId || '', status, edited: false };
    },
    onSuccess: ({ invoiceId, status, edited }: any) => {
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoice', activeBusiness?.id, editId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['receivables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales-purchases-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      if (edited) {
        toast('Invoice updated successfully', 'success');
        navigate(`/app/sales-invoices/${invoiceId}`);
      } else {
        toast(status === 'draft' ? 'Draft saved — issue it from the invoices list' : 'Invoice issued successfully', 'success');
        navigate(status === 'draft' ? '/app/sales-invoices' : invoiceId ? `/app/sales-invoices/${invoiceId}` : '/app/sales-invoices');
      }
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
    id: editId || 'preview',
    business_id: activeBusiness?.id || '',
    customer_id: customerId,
    invoice_number: invoiceNumber || `${activeBusiness?.invoice_prefix || 'INV'}/…/PREVIEW`,
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
    paid_amount: existingQuery.data?.invoice.paid_amount || 0,
    balance_amount: totals.grandTotal - Number(existingQuery.data?.invoice.paid_amount || 0),
    payment_status: (existingQuery.data?.invoice.payment_status || 'unpaid') as any,
    status: (existingQuery.data?.invoice.status || 'draft') as any,
    payment_method: paymentMethod || null,
    notes: notes || null,
    created_by: null,
    created_at: '',
    updated_at: '',
    customer: selectedCustomer,
  } as unknown as InvoiceWithCustomer;

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
        title={isEdit ? `Edit Invoice #${invoiceNumber || existingQuery.data?.invoice.invoice_number || ''}` : 'New Sale Invoice'}
        subtitle={isEdit ? 'Update invoice details and line items' : 'Create and issue a GST compliant invoice'}
        actions={
          <Button variant="secondary" onClick={() => navigate(isEdit ? `/app/sales-invoices/${editId}` : '/app/sales-invoices')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div>
        <div className="card p-6 min-w-0">
          <FormSection>
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
          >
            <div className="overflow-x-auto scrollbar-thin -mx-2">
              <div className="min-w-[900px] px-2 text-sm">
                <div className="grid grid-cols-[1fr_100px_70px_100px_80px_90px_100px_40px] items-center gap-2 border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <div className="py-2 font-medium text-left">Product</div>
                  <div className="py-2 font-medium text-center">HSN/SAC</div>
                  <div className="py-2 font-medium text-center">Qty</div>
                  <div className="py-2 font-medium text-center">Rate</div>
                  <div className="py-2 font-medium text-center">Disc</div>
                  <div className="py-2 font-medium text-center">Tax %</div>
                  <div className="py-2 font-medium text-right">Amount</div>
                  <div />
                </div>
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_100px_70px_100px_80px_90px_100px_40px] items-center gap-2 border-b border-secondary-100 dark:border-secondary-800/50">
                    <div className="py-2 min-w-0">
                      <select
                        ref={(el) => { rowRefs.current[idx] = el; }}
                        value={item.product_id || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          const p = products?.find((pr) => pr.id === val);
                          if (p) {
                            updateItem(idx, {
                              product_id: p.id,
                              product_name: p.name,
                              hsn_sac: p.hsn_sac || '',
                              unit: p.unit || 'PCS',
                              rate: p.selling_price || 0,
                              tax_rate: p.tax_rate || 0,
                            });
                          } else {
                            updateItem(idx, { product_id: null, product_name: '', hsn_sac: '', unit: 'PCS', rate: 0, tax_rate: 0 });
                          }
                        }}
                        onKeyDown={(e) => handleRowKeyDown(e, idx)}
                        className="input w-full"
                      >
                        <option value="">-- Select Product --</option>
                        {products?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.selling_price ? `(₹${p.selling_price})` : ''} {p.current_stock !== undefined ? `[Stock: ${p.current_stock}]` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="py-2">
                      <Input
                        value={item.hsn_sac}
                        onChange={(e) => updateItem(idx, { hsn_sac: e.target.value })}
                        placeholder="HSN/SAC"
                        className="text-center font-mono text-xs"
                      />
                    </div>
                    <div className="py-2">
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                        className="text-center font-mono"
                      />
                    </div>
                    <div className="py-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.rate}
                        onChange={(e) => updateItem(idx, { rate: Math.max(0, Number(e.target.value)) })}
                        className="text-center font-mono"
                      />
                    </div>
                    <div className="py-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discount_amount}
                        onChange={(e) => updateItem(idx, { discount_amount: Math.max(0, Number(e.target.value)) })}
                        className="text-center font-mono"
                      />
                    </div>
                    <div className="py-2">
                      <select
                        value={item.tax_rate}
                        onChange={(e) => updateItem(idx, { tax_rate: Number(e.target.value) })}
                        className="input w-full text-center font-mono text-xs px-1"
                      >
                        {Array.from(new Set([...GST_SLABS, Number(item.tax_rate)])).sort((a, b) => a - b).map((r) => (
                          <option key={r} value={r}>{r}%</option>
                        ))}
                      </select>
                    </div>
                    <div className="py-2 text-right font-medium figure">
                      {formatCurrency(item.total_amount, sym)}
                    </div>
                    <div className="py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-1 rounded text-secondary-500 dark:text-secondary-400 hover:text-error-500 hover:bg-error-50 dark:hover:bg-error-900/20"
                        title="Delete item"
                        aria-label="Delete item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="py-3">
                  <button
                    type="button"
                    onClick={addItem}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-secondary-300 dark:border-secondary-700 text-sm font-medium text-primary-600 dark:text-primary-400 hover:border-primary-400 hover:bg-primary-50/60 dark:hover:bg-primary-900/20 transition-colors"
                  >
                    <Plus className="h-4 w-4" /> Add another product
                  </button>
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              <div className="space-y-4">
                <div>
                  <label className="label">Payment Method</label>
                  <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="">Select payment method...</option>
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI / QR</option>
                    <option value="Bank Transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Credit / Pending">Credit / Pending</option>
                  </select>
                </div>
                <div>
                  <label className="label">Customer Notes</label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms, delivery instructions, or notes for the customer..." />
                </div>
              </div>
              <div className="w-full md:w-80 md:ml-auto">
                {totalRows}
              </div>
            </div>
          </FormSection>
        </div>

        {/* Hidden A4 sheet render — print/PDF source only (no visible preview) */}
        <div aria-hidden="true" className="fixed -left-[9999px] top-0 w-[210mm] pointer-events-none select-none print:static print:w-auto">
          <div id="invoice-print-area">
            <InvoiceSheet
              business={mergeBusinessExtras(activeBusiness, activeBusiness?.id || '')}
              invoice={previewInvoice}
              items={previewItems.length > 0 ? previewItems : []}
            />
          </div>
        </div>
      </div>

      {/* Sticky action footer */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md print:hidden">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => navigate(isEdit ? `/app/sales-invoices/${editId}` : '/app/sales-invoices')}>
            Cancel
          </Button>
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
            {isEdit ? (
              <button
                onClick={() => handleGuardedSave('issued')}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 h-10 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Update Invoice
              </button>
            ) : (
              <>
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
              </>
            )}
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
          <Button onClick={() => navigate('/app/settings')}>
            Upgrade Plan
          </Button>
        </div>
      </Modal>
      <Modal
        open={maintenanceModalOpen}
        onClose={() => setMaintenanceModalOpen(false)}
        title="System maintenance in progress"
        size="sm"
      >
        <p className="text-sm text-secondary-600 dark:text-secondary-300">
          AccountX is undergoing scheduled maintenance. Invoice creation is
          temporarily paused for regular users. Please check back shortly.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setMaintenanceModalOpen(false)}>
            Understood
          </Button>
        </div>
      </Modal>
    </div>
  );
}