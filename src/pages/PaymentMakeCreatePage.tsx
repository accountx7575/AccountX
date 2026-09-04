import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input, FormField } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, CreditCard } from 'lucide-react';
import { formatCurrency, todayDateString, roundTo2 } from '@/lib/utils';
import { buildAllocationRequest } from '@/lib/payloads';
import type { Supplier, PurchaseBill } from '@/types/db';

export function PaymentMakeCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    supplierId: '', billId: '', amount: '', date: todayDateString(),
    payment_method: 'cash', reference: '', notes: '',
  });
  const [bills, setBills] = useState<PurchaseBill[]>([]);

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('suppliers').select('*').eq('business_id', activeBusiness.id).eq('status', 'active').order('name');
      return data as Supplier[];
    },
    enabled: !!activeBusiness,
  });

  useEffect(() => {
    if (form.supplierId && activeBusiness) {
      supabase.from('purchase_bills').select('*')
        .eq('business_id', activeBusiness.id).eq('supplier_id', form.supplierId)
        .in('status', ['confirmed', 'partially_paid']).gt('balance_amount', 0).order('bill_date', { ascending: false })
        .then(({ data }) => setBills((data || []) as PurchaseBill[]));
    } else { setBills([]); }
  }, [form.supplierId, activeBusiness]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.supplierId) throw new Error('Please select a supplier');
      if (!form.amount || parseFloat(form.amount) <= 0) throw new Error('Please enter a valid amount');

      let allocatedTo = '';
      if (form.billId) {
        const bill = bills.find((b) => b.id === form.billId);
        if (bill) {
          buildAllocationRequest('purchase_bill', bill.id, parseFloat(form.amount), Number(bill.balance_amount));
          allocatedTo = bill.bill_number;
        }
      }

      const { data, error } = await supabase.rpc('create_payment_with_allocation', {
        p_business_id: activeBusiness.id,
        p_type: 'made',
        p_party_id: form.supplierId,
        p_amount: roundTo2(parseFloat(form.amount)),
        p_payment_date: form.date,
        p_method: form.payment_method,
        p_reference: form.reference || null,
        p_notes: form.notes || null,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      return { allocatedTotal: Number(result?.allocated_total ?? 0), allocatedTo };
    },
    onSuccess: ({ allocatedTotal, allocatedTo }) => {
      queryClient.invalidateQueries({ queryKey: ['payments-made', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['purchase-bills', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['liquid-cash', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['payables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast(
        allocatedTo
          ? `Payment recorded — ${formatCurrency(allocatedTotal, activeBusiness?.currency_symbol)} allocated to ${allocatedTo}`
          : 'Payment recorded successfully',
        'success'
      );
      navigate('/app/payments-made');
    },
    onError: (err: any) => toast(err.message || 'Failed to record payment', 'error'),
  });

  return (
    <div>
      <PageHeader
        title="Make Payment"
        actions={<Button variant="secondary" onClick={() => navigate('/app/payments-made')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Party & Allocation" description="Optionally allocate against an open bill — balance autofills the amount">
          <div className="space-y-4 max-w-xl">
            <FormField label="Supplier" required>
              <select className="input" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, billId: '' })}>
                <option value="">Select supplier...</option>
                {suppliers?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
            {bills.length > 0 && (
              <FormField label="Against Bill (optional)">
                <select className="input" value={form.billId} onChange={(e) => { setForm({ ...form, billId: e.target.value }); const b = bills.find((i) => i.id === e.target.value); if (b) setForm((f) => ({ ...f, amount: String(b.balance_amount) })); }}>
                  <option value="">—</option>
                  {bills.map((b) => <option key={b.id} value={b.id}>{b.bill_number} — Balance: {formatCurrency(b.balance_amount, activeBusiness?.currency_symbol)}</option>)}
                </select>
              </FormField>
            )}
          </div>
        </FormSection>

        <FormSection title="Payment">
          <div className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Amount" required><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></FormField>
              <FormField label="Date" required><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} /></FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Payment Method">
                <select className="input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="card">Card</option><option value="cheque">Cheque</option>
                </select>
              </FormField>
              <FormField label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UTR / Cheque No." /></FormField>
            </div>
            <FormField label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/payments-made')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <CreditCard className="h-4 w-4" /> Make Payment
          </Button>
        </div>
      </div>
    </div>
  );
}
