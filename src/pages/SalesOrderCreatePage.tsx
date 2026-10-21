import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { allocateDocumentNumber, documentNumberTaken } from '@/lib/numbering';
import {
  DocumentNumberField,
  DUPLICATE_DOCUMENT_NUMBER_MESSAGE,
  useDocumentNumber,
} from '@/components/documents/DocumentNumberField';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input, FormField, Textarea } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Save, Trash2, Plus } from 'lucide-react';
import { formatCurrency, roundTo2, todayDateString } from '@/lib/utils';
import { calculateGstAmounts } from '@/lib/accounting';
import { computeDocLine } from '@/lib/payloads';
import { saveDemoDoc, defaultDemoNumber, countDemoDocs } from '@/lib/demoStore';
import type { Customer, Product, SalesOrder, SalesOrderItem } from '@/types/db';

type LineItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  rate: number;
  discount_amount: number;
  tax_rate: number;
  unit?: string;
  hsn_sac?: string | null;
  taxable_amount: number;
  total_amount: number;
};

const emptyLine: LineItem = { product_id: null, product_name: '', quantity: 1, rate: 0, discount_amount: 0, tax_rate: 18, taxable_amount: 0, total_amount: 0 };

// Mirror of SalesInvoiceCreatePage's slab picker (single house widget).
const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28];

// Terminal-state orders are immutable — mirrors SalesOrdersPage LOCKED semantics.
const EDITABLE_STATUSES = new Set(['draft', 'confirmed']);

export function SalesOrderCreatePage({ demo = false }: { demo?: boolean } = {}) {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { id: editId } = useParams<{ id: string }>();
  const isEdit = Boolean(editId);

  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(todayDateString());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([{ ...emptyLine }]);

  // Edit mode: fetch the existing order + its line items and populate form state
  const existingQuery = useQuery({
    queryKey: ['sales-order', activeBusiness?.id, editId],
    queryFn: async () => {
      const { data: order, error } = await supabase
        .from('sales_orders')
        .select('*')
        .eq('business_id', activeBusiness!.id)
        .eq('id', editId!)
        .single();
      if (error) throw error;
      const { data: items, error: itemsError } = await supabase
        .from('sales_order_items')
        .select('*')
        .eq('sales_order_id', editId!)
        .order('created_at');
      if (itemsError) throw itemsError;
      return { order: order as SalesOrder, items: (items || []) as SalesOrderItem[] };
    },
    enabled: isEdit && !!activeBusiness,
  });

  useEffect(() => {
    const loaded = existingQuery.data;
    if (!loaded) return;
    setCustomerId(loaded.order.customer_id);
    setOrderDate(loaded.order.order_date);
    setExpectedDate(loaded.order.expected_date || '');
    setNotes(loaded.order.notes || '');
    if (loaded.items.length > 0) {
      setLines(loaded.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        discount_amount: 0,
        taxable_amount: Number(it.taxable_amount || 0),
        total_amount: Number(it.total_amount || 0),
        quantity: Number(it.quantity),
        rate: Number(it.rate),
        tax_rate: Number(it.tax_rate),
        unit: it.unit || 'PCS',
        hsn_sac: it.hsn_sac || null,
      })));
    }
  }, [existingQuery.data]);

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
    setLines((prev) => {
      const next = [...prev];
      const cur = { ...next[idx], ...updates };
      const line = computeDocLine({
        quantity: cur.quantity,
        rate: cur.rate,
        discount_amount: cur.discount_amount,
        tax_rate: cur.tax_rate,
        isInterState,
      });
      next[idx] = {
        ...cur,
        taxable_amount: line.taxable_amount,
        total_amount: line.total_amount,
      };
      return next;
    });
  };

  const rowRefs = useRef<(HTMLSelectElement | null)[]>([]);

  const addLine = () => {
    setLines((prev) => [...prev, { ...emptyLine }]);
    setTimeout(() => {
      const last = rowRefs.current[lines.length];
      last?.focus();
    }, 50);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => {
      if (prev.length <= 1) {
        return [{ ...emptyLine }];
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLSelectElement>, idx: number) => {
    if (e.key === 'Tab' && !e.shiftKey && idx === lines.length - 1) {
      if (lines[idx].product_id) {
        e.preventDefault();
        addLine();
      }
    }
  };

  const totals = useMemo(() => {
    let subtotal = 0, totalDiscount = 0, taxableAmount = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      if (!l.product_name.trim()) continue;
      const line = computeDocLine({ quantity: l.quantity, rate: l.rate, discount_amount: l.discount_amount, tax_rate: l.tax_rate, isInterState });
      subtotal += line.gross_amount;
      totalDiscount += roundTo2(l.discount_amount);
      taxableAmount += line.taxable_amount;
      cgst += line.cgst_amount;
      sgst += line.sgst_amount;
      igst += line.igst_amount;
    }
    const grandTotal = roundTo2(roundTo2(taxableAmount) + roundTo2(cgst + sgst + igst));
    return { subtotal: roundTo2(subtotal), totalDiscount: roundTo2(totalDiscount), taxableAmount: roundTo2(taxableAmount), cgst: roundTo2(cgst), sgst: roundTo2(sgst), igst: roundTo2(igst), grandTotal };
  }, [lines, isInterState]);

  // PBS-142: one document-number path for create + edit (suggestion, free-text
  // override, duplicate guard scoped to this business).
  const docNumber = useDocumentNumber({
    businessId: activeBusiness?.id,
    docType: 'sales_order',
    table: 'sales_orders',
    numberColumn: 'order_number',
    date: orderDate,
    initialValue: isEdit ? existingQuery.data?.order?.order_number ?? null : null,
    excludeId: editId ?? null,
    enabled: !demo,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!customerId) throw new Error('Please select a customer');
      const validLines = lines.filter((l) => l.product_name.trim() && l.quantity > 0);
      if (!validLines.length) throw new Error('Add at least one line with a description and quantity');

      // Demo/Proforma sandbox (PBS-112): zero effect on real books — no
      // sales_orders/sales_order_items rows, no counters, no journal, no stock.
      if (demo) {
        const demoRows = validLines.map((l) => {
          const line = computeDocLine({ quantity: l.quantity, rate: l.rate, discount_amount: l.discount_amount, tax_rate: l.tax_rate, isInterState });
          return {
            product_id: l.product_id || null,
            product_name: l.product_name.trim(),
            hsn_sac: l.hsn_sac ?? null,
            quantity: l.quantity,
            unit: l.unit || 'PCS',
            rate: l.rate,
            discount_amount: l.discount_amount,
            tax_rate: l.tax_rate,
            taxable_amount: line.taxable_amount,
            cgst_amount: line.cgst_amount,
            sgst_amount: line.sgst_amount,
            igst_amount: line.igst_amount,
            total_amount: line.total_amount,
          };
        });
        const saved = saveDemoDoc(
          activeBusiness.id,
          'sales_order',
          {
            order_number: defaultDemoNumber('sales_order', countDemoDocs(activeBusiness.id, 'sales_order') + 1),
            customer_id: customerId,
            order_date: orderDate,
            expected_date: expectedDate || null,
            subtotal: totals.subtotal,
            discount_amount: totals.totalDiscount,
            taxable_amount: totals.taxableAmount,
            cgst_amount: totals.cgst,
            sgst_amount: totals.sgst,
            igst_amount: totals.igst,
            round_off: 0,
            grand_total: totals.grandTotal,
            status: 'draft',
            notes: notes || null,
          },
          demoRows,
          customers?.find((c) => c.id === customerId) as unknown as Record<string, unknown> | null
        );
        return { edited: false, orderId: saved.id };
      }

      // Edit mode: UPDATE the existing order header (status and order_number
      // untouched) and replace its line items, mirroring the sales-invoice edit path.
      if (isEdit) {
        const loaded = existingQuery.data;
        if (!loaded) throw new Error('Order not loaded yet');
        if (!EDITABLE_STATUSES.has(loaded.order.status)) {
          throw new Error('This order is in a terminal state and can no longer be edited');
        }
        const validatedNumber = await docNumber.validate();
        if (!validatedNumber) throw new Error(DUPLICATE_DOCUMENT_NUMBER_MESSAGE);

        const { error: headerError } = await supabase
          .from('sales_orders')
          .update({
            order_number: validatedNumber,
            customer_id: customerId,
            order_date: orderDate,
            expected_date: expectedDate || null,
            subtotal: totals.subtotal,
            discount_amount: totals.totalDiscount,
            taxable_amount: totals.taxableAmount,
            cgst_amount: totals.cgst,
            sgst_amount: totals.sgst,
            igst_amount: totals.igst,
            cess_amount: 0,
            round_off: 0,
            grand_total: totals.grandTotal,
            notes: notes || null,
          })
          .eq('business_id', activeBusiness.id)
          .eq('id', editId!);
        if (headerError) throw headerError;

        const { error: clearError } = await supabase
          .from('sales_order_items')
          .delete()
          .eq('sales_order_id', editId!);
        if (clearError) throw clearError;

        const rows = validLines.map((l) => {
          const line = computeDocLine({ quantity: l.quantity, rate: l.rate, discount_amount: l.discount_amount, tax_rate: l.tax_rate, isInterState });
          return {
            business_id: activeBusiness.id,
            sales_order_id: editId!,
            product_id: l.product_id,
            product_name: l.product_name.trim(),
            hsn_sac: l.hsn_sac ?? null,
            quantity: l.quantity,
            unit: l.unit || 'PCS',
            rate: l.rate,
            tax_rate: l.tax_rate,
            taxable_amount: line.taxable_amount,
            total_amount: line.total_amount,
          };
        });
        const { error: itemsError } = await supabase.from('sales_order_items').insert(rows);
        if (itemsError) throw itemsError;
        return { edited: true };
      }

      const { data: userData } = await supabase.auth.getUser();

      // Number + insert with ONE retry on duplicate key (23505): each attempt
      // re-allocates from a fresh scan of existing numbers, so a stale counter
      // or a racing tab is stepped past instead of failing twice in a row.
      let createdOrder: { id: string } | null = null;
      let insertError: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        // PBS-142: a user-typed number is honoured verbatim; otherwise the
        // numbering service suggests one (prefix + FY).
        const typedNumber = docNumber.value.trim();
        const orderNumber = typedNumber
          ? typedNumber
          : await allocateDocumentNumber({
              businessId: activeBusiness.id,
              docType: 'sales_order',
              table: 'sales_orders',
              numberColumn: 'order_number',
              date: orderDate,
            });
        if (typedNumber) {
          const taken = await documentNumberTaken({
            table: 'sales_orders',
            column: 'order_number',
            businessId: activeBusiness.id,
            value: typedNumber,
          });
          if (taken) throw new Error(DUPLICATE_DOCUMENT_NUMBER_MESSAGE);
        }

        const res = await supabase.from('sales_orders').insert({
          business_id: activeBusiness.id,
          order_number: orderNumber,
          customer_id: customerId,
          order_date: orderDate,
          expected_date: expectedDate || null,
          subtotal: totals.subtotal,
          discount_amount: totals.totalDiscount,
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
        if (!res.error) {
          createdOrder = res.data;
          break;
        }
        insertError = res.error;
        if (res.error.code !== '23505') break;
      }
      if (insertError || !createdOrder) {
        if (insertError?.code === '23505') {
          throw new Error('Could not allocate a unique order number — please try again');
        }
        throw insertError;
      }

      const { error: itemsError } = await supabase.from('sales_order_items').insert(
        validLines.map((l) => {
          const line = computeDocLine({ quantity: l.quantity, rate: l.rate, discount_amount: l.discount_amount, tax_rate: l.tax_rate, isInterState });
          return {
            business_id: activeBusiness.id,
            sales_order_id: createdOrder.id,
            product_id: l.product_id,
            product_name: l.product_name.trim(),
            hsn_sac: l.hsn_sac ?? null,
            quantity: l.quantity,
            unit: l.unit || 'PCS',
            rate: l.rate,
            tax_rate: l.tax_rate,
            taxable_amount: line.taxable_amount,
            total_amount: line.total_amount,
          };
        })
      );
      if (itemsError) {
        // Client rollback: never leave an orphaned header behind.
        await supabase.from('sales_orders').delete().eq('id', createdOrder.id);
        throw itemsError;
      }
      return { edited: false };
    },
    onSuccess: ({ edited, orderId }: { edited: boolean; orderId?: string }) => {
      ['sales-orders', 'dashboard-stats'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      if (demo && orderId) {
        toast('Demo sales order saved — sandbox only, books untouched', 'success');
        navigate(`/app/demo/orders/${orderId}`);
        return;
      }
      if (edited) {
        queryClient.invalidateQueries({ queryKey: ['sales-order', activeBusiness?.id, editId] });
        toast('Sales order updated', 'success');
        navigate('/app/sales-orders');
        return;
      }
      toast('Sales order draft saved', 'success');
      navigate('/app/sales-orders');
    },
    onError: (err: any) => toast(err.message || 'Failed to save sales order', 'error'),
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title={isEdit ? `Edit Sales Order #${existingQuery.data?.order.order_number || ''}` : demo ? 'New Demo Sales Order' : 'New Sales Order'}
        actions={<Button variant="secondary" onClick={() => navigate(demo ? '/app/demo/orders' : '/app/sales-orders')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-start">
            <DocumentNumberField
              value={docNumber.value}
              onChange={docNumber.setValue}
              error={docNumber.error}
              suggesting={docNumber.suggesting}
              className="h-10"
            />

            <FormField label="Customer" required>
              <select className="input h-10" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select customer...</option>
                {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Order Date" required><DatePicker className="input h-10" value={orderDate} onChange={setOrderDate} /></FormField>
            <FormField label="Expected Delivery"><DatePicker className="input h-10" value={expectedDate} onChange={setExpectedDate} /></FormField>
          </div>
          {isInterState && (
            <div className="mt-3 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-300 text-sm">
              Inter-state transaction detected — IGST will be applied instead of CGST + SGST.
            </div>
          )}
        </FormSection>

        <FormSection>
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
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_70px_100px_80px_90px_100px_40px] items-center gap-2 border-b border-secondary-100 dark:border-secondary-800/50">
                  <div className="py-2 min-w-0">
                    <select
                      ref={(el) => { rowRefs.current[idx] = el; }}
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
                          updateLine(idx, { product_id: null, product_name: '', hsn_sac: '', unit: 'PCS', rate: 0, tax_rate: 0 });
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
                      value={l.hsn_sac || ''}
                      onChange={(e) => updateLine(idx, { hsn_sac: e.target.value })}
                      placeholder="HSN/SAC"
                      className="text-center font-mono text-xs"
                    />
                  </div>
                  <div className="py-2">
                    <Input
                      type="number"
                      min="1"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                      className="text-center font-mono"
                    />
                  </div>
                  <div className="py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.rate}
                      onChange={(e) => updateLine(idx, { rate: Math.max(0, Number(e.target.value)) })}
                      className="text-center font-mono"
                    />
                  </div>
                  <div className="py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.discount_amount}
                      onChange={(e) => updateLine(idx, { discount_amount: Math.max(0, Number(e.target.value)) })}
                      className="text-center font-mono"
                    />
                  </div>
                  <div className="py-2">
                    <select
                      value={l.tax_rate}
                      onChange={(e) => updateLine(idx, { tax_rate: Number(e.target.value) })}
                      className="input w-full text-center font-mono text-xs px-1"
                    >
                      {Array.from(new Set([...GST_SLABS, Number(l.tax_rate)])).sort((a, b) => a - b).map((r) => (
                        <option key={r} value={r}>{r}%</option>
                      ))}
                    </select>
                  </div>
                  <div className="py-2 text-right font-medium figure">
                    {formatCurrency(l.total_amount, sym)}
                  </div>
                  <div className="py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
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
                  onClick={addLine}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-secondary-300 dark:border-secondary-700 text-sm font-medium text-primary-600 dark:text-primary-400 hover:border-primary-400 hover:bg-primary-50/60 dark:hover:bg-primary-900/20 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add another product
                </button>
              </div>
            </div>
          </div>
          <p className="text-xs text-secondary-400 mt-3">Numbered via the document service on save. Orders have no stock impact until fulfilled.</p>
        </FormSection>

        <FormSection>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div>
              <FormField label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery expectations, special instructions..." /></FormField>
            </div>
            <div className="w-full sm:w-80 md:ml-auto space-y-2">
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
              <div className="border-t border-secondary-200 dark:border-secondary-800 pt-2 flex justify-between items-baseline">
                <span className="text-base font-semibold">Grand Total</span>
                <span className="figure text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(totals.grandTotal, sym)}</span>
              </div>
            </div>
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate(demo ? '/app/demo/orders' : '/app/sales-orders')}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            <Save className="h-4 w-4" /> {isEdit ? 'Save Changes' : 'Save Draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
