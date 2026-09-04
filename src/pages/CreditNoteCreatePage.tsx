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
import type { SalesInvoiceItem } from '@/types/db';

type InvoiceOptionRow = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  place_of_supply: string | null;
  customer_id: string;
  customer: { name: string } | null;
};

type DraftLine = {
  sales_invoice_item_id: string | null;
  product_id: string | null;
  product_name: string;
  quantity: number;
  maxQuantity: number;
  rate: number;
  tax_rate: number;
};

export function CreditNoteCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [date, setDate] = useState(todayDateString());
  const [lines, setLines] = useState<DraftLine[]>([]);

  const { data: invoices } = useQuery({
    queryKey: ['sales-invoices', activeBusiness?.id, 'live-for-cn'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('sales_invoices').select('id, invoice_number, invoice_date, place_of_supply, customer_id, customer:customers(name)').eq('business_id', activeBusiness.id).in('status', ['issued', 'partially_paid', 'paid']).order('invoice_date', { ascending: false }).limit(100);
      return (data || []) as unknown as InvoiceOptionRow[];
    },
    enabled: !!activeBusiness,
  });

  const loadInvoiceItems = async (invId: string) => {
    setInvoiceId(invId);
    setLines([]);
    if (!invId) return;
    const { data, error } = await supabase.from('sales_invoice_items').select('id, product_id, product_name, quantity, rate, tax_rate').eq('invoice_id', invId);
    if (error) return toast(error.message, 'error');
    setLines((data as SalesInvoiceItem[]).map((it) => ({
      sales_invoice_item_id: it.id,
      product_id: it.product_id,
      product_name: it.product_name,
      quantity: 0,
      maxQuantity: Number(it.quantity),
      rate: Number(it.rate),
      tax_rate: Number((it as unknown as { tax_rate?: number }).tax_rate ?? 0),
    })));
  };

  const isInterState = useMemo(() => {
    if (!activeBusiness || !invoiceId) return false;
    const inv = invoices?.find((i) => i.id === invoiceId);
    return !!(inv?.place_of_supply && activeBusiness.state && inv.place_of_supply !== activeBusiness.state);
  }, [activeBusiness, invoices, invoiceId]);

  const totals = useMemo(() => {
    let taxableAmount = 0, cgst = 0, sgst = 0, igst = 0;
    for (const l of lines) {
      if (l.quantity <= 0) continue;
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
      const inv = invoices?.find((i) => i.id === invoiceId);
      if (!inv) throw new Error('Please select an invoice');
      const returnLines = lines.filter((l) => l.quantity > 0);
      if (!returnLines.length) throw new Error('Enter a return quantity on at least one line');
      for (const l of returnLines) {
        if (l.quantity > l.maxQuantity) throw new Error(`Return qty for ${l.product_name} exceeds invoiced qty`);
      }
      const { data: userData } = await supabase.auth.getUser();
      const tempNumber = `DRAFT-CN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const { data: note, error } = await supabase.from('credit_notes').insert({
        business_id: activeBusiness.id,
        credit_note_number: tempNumber,
        sales_invoice_id: invoiceId,
        customer_id: inv.customer_id,
        date,
        reason: reason || null,
        restock,
        subtotal: totals.subtotal,
        taxable_amount: totals.taxableAmount,
        cgst_amount: totals.cgst,
        sgst_amount: totals.sgst,
        igst_amount: totals.igst,
        cess_amount: 0,
        round_off: 0,
        grand_total: totals.grandTotal,
        created_by: userData.user?.id,
      }).select('id').single();
      if (error) throw error;

      const { error: itemsError } = await supabase.from('credit_note_items').insert(
        returnLines.map((l) => {
          const taxable = roundTo2(l.quantity * l.rate);
          const gst = calculateGstAmounts(taxable, l.tax_rate, isInterState);
          return {
            business_id: activeBusiness.id,
            credit_note_id: note.id,
            sales_invoice_item_id: l.sales_invoice_item_id,
            product_id: l.product_id,
            product_name: l.product_name,
            quantity: l.quantity,
            rate: l.rate,
            taxable_amount: taxable,
            tax_amount: roundTo2(gst.total_tax),
            total_amount: roundTo2(taxable + gst.total_tax),
          };
        })
      );
      if (itemsError) {
        await supabase.from('credit_notes').delete().eq('id', note.id);
        throw itemsError;
      }
      return note.id;
    },
    onSuccess: () => {
      ['credit-notes', 'dashboard-stats', 'accounts', 'journal-entries', 'trial-balance', 'products', 'stock-movements'].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k, activeBusiness?.id] })
      );
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      toast('Credit note draft saved. Issue it to post the reversal.', 'success');
      navigate('/app/credit-notes');
    },
    onError: (err: any) => toast(err.message || 'Failed to save credit note', 'error'),
  });

  const selectedCustomerName = invoices?.find((i) => i.id === invoiceId)?.customer?.name;
  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title="New Credit Note"
        actions={<Button variant="secondary" onClick={() => navigate('/app/credit-notes')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Against Invoice" description="Credit notes reference a live sales invoice — pick one to load its lines">
          <div className="space-y-3 max-w-xl">
            <FormField label="Sales Invoice" required>
              <select className="input" value={invoiceId} onChange={(e) => loadInvoiceItems(e.target.value)}>
                <option value="">Select invoice...</option>
                {invoices?.map((i) => <option key={i.id} value={i.id}>{i.invoice_number}{i.customer ? ` — ${i.customer.name}` : ''}</option>)}
              </select>
            </FormField>
            {selectedCustomerName && <p className="text-xs text-secondary-400">Customer: {selectedCustomerName}{isInterState ? ' · Inter-state (IGST)' : ''}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Date" required><DatePicker value={date} onChange={setDate} /></FormField>
              <FormField label="Restock returned goods">
                <label className="flex items-center gap-2 h-10 cursor-pointer select-none">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4 accent-primary-600" />
                  <span className="text-sm text-secondary-600 dark:text-secondary-300">Add quantities back to stock on issue</span>
                </label>
              </FormField>
            </div>
          </div>
        </FormSection>

        {lines.length > 0 && (
          <FormSection title="Return Lines" description="Enter the quantity being returned per invoiced line">
            <div className="border border-secondary-200 dark:border-secondary-800 rounded-lg divide-y divide-secondary-100 dark:divide-secondary-800/50">
              <div className="grid grid-cols-[1fr_7rem_7rem] gap-2 px-3 py-2 text-xs font-medium text-secondary-400">
                <span>Product</span><span className="text-right">Invoiced</span><span className="text-right">Return Qty</span>
              </div>
              {lines.map((l, idx) => (
                <div key={l.sales_invoice_item_id ?? idx} className="grid grid-cols-[1fr_7rem_7rem] gap-2 px-3 py-2 items-center">
                  <span className="text-sm text-secondary-900 dark:text-secondary-100 truncate">{l.product_name}</span>
                  <span className="figure text-sm text-secondary-400 text-right">{l.maxQuantity}</span>
                  <Input type="number" min={0} max={l.maxQuantity} value={String(l.quantity)}
                    onChange={(e) => {
                      const v = Math.min(parseFloat(e.target.value) || 0, l.maxQuantity);
                      setLines((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: Math.max(0, v) } : p)));
                    }} className="text-right figure" />
                </div>
              ))}
            </div>
          </FormSection>
        )}

        <FormSection title="Reason & Totals">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-1 max-w-xl">
              <FormField label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged goods, price adjustment..." /></FormField>
              <p className="text-xs text-secondary-400 mt-3">Saved as draft — numbering is assigned when you Issue.</p>
            </div>
            {totals.grandTotal > 0 && (
              <div className="w-full sm:w-72 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-secondary-500">Taxable</span><span className="figure">{formatCurrency(totals.taxableAmount, sym)}</span></div>
                <div className="flex justify-between"><span className="text-secondary-500">{isInterState ? 'IGST' : 'CGST + SGST'}</span><span className="figure">{formatCurrency(isInterState ? totals.igst : roundTo2(totals.cgst + totals.sgst), sym)}</span></div>
                <div className="flex justify-between font-semibold border-t border-secondary-200 dark:border-secondary-700 pt-1 mt-1"><span>Credit Total</span><span className="figure text-primary-600 dark:text-primary-400">{formatCurrency(totals.grandTotal, sym)}</span></div>
              </div>
            )}
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/credit-notes')}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            <Save className="h-4 w-4" /> Save Draft
          </Button>
        </div>
      </div>
    </div>
  );
}
