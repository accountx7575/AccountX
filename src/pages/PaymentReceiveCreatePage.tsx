import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { TimePicker } from '@/components/common/TimePicker';
import { Input, FormField, Textarea, Select } from '@/components/ui/Input';
import { ArrowLeft, Banknote } from 'lucide-react';
import { formatCurrency, todayDateString, getLocalNowTime, roundTo2 } from '@/lib/utils';
import { buildAllocationRequest } from '@/lib/payloads';
import { documentNumberTaken } from '@/lib/numbering';
import { fetchNextPaymentReceivedNumber } from '@/lib/numberingSync';
import type { Customer, SalesInvoice, Payment } from '@/types/db';

export function PaymentReceiveCreatePage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    paymentNumber: '',
    customerId: '',
    invoiceId: '',
    amount: '',
    date: todayDateString(),
    time: getLocalNowTime(),
    payment_method: 'cash',
    reference: '',
    notes: '',
    advanceUnallocated: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isManualNumberEdited, setIsManualNumberEdited] = useState(false);
  const [isSuggestingNumber, setIsSuggestingNumber] = useState(false);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);

  const { data: existingPayment } = useQuery({
    queryKey: ['payment', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as Payment;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (existingPayment) {
      setForm({
        paymentNumber: existingPayment.payment_number || '',
        customerId: existingPayment.party_id || (existingPayment as any).customer_id || '',
        invoiceId: existingPayment.invoice_id || '',
        amount: String(existingPayment.amount ?? ''),
        date: existingPayment.payment_date || existingPayment.date || todayDateString(),
        time: existingPayment.time
          ? existingPayment.time
          : existingPayment.created_at
          ? new Date(existingPayment.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : getLocalNowTime(),
        payment_method: existingPayment.payment_method || 'cash',
        reference: existingPayment.reference || '',
        notes: existingPayment.notes || '',
        advanceUnallocated: !existingPayment.invoice_id,
      });
      setIsManualNumberEdited(true);
    }
  }, [existingPayment]);

  // Auto-generate dynamic prefix sequence in Create mode (PR/ABC/SE/26-27/1)
  useEffect(() => {
    if (id || !activeBusiness?.id) return;
    if (isManualNumberEdited) return;

    let cancelled = false;
    setIsSuggestingNumber(true);

    fetchNextPaymentReceivedNumber(activeBusiness, form.date)
      .then((suggested) => {
        if (!cancelled && suggested) {
          setForm((prev) => ({ ...prev, paymentNumber: suggested }));
        }
      })
      .catch((err) => {
        console.warn('Failed to auto-generate receipt number:', err);
      })
      .finally(() => {
        if (!cancelled) setIsSuggestingNumber(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, activeBusiness, form.date, isManualNumberEdited]);

  const { data: customers } = useQuery({
    queryKey: ['customers', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .eq('status', 'active')
        .order('name');
      return data as Customer[];
    },
    enabled: !!activeBusiness,
  });

  useEffect(() => {
    if (form.customerId && activeBusiness?.id) {
      Promise.resolve(
        supabase
          .from('sales_invoices')
          .select('*')
          .eq('business_id', activeBusiness.id)
          .eq('customer_id', form.customerId)
          .in('status', ['issued', 'partially_paid'])
          .gt('balance_amount', 0)
          .order('invoice_date', { ascending: false })
          .then(({ data, error }) => {
            if (error) throw error;
            setInvoices((data || []) as SalesInvoice[]);
          })
      ).catch((err: any) => toast(err?.message || 'Failed to load open invoices', 'error'));
    } else {
      setInvoices([]);
    }
  }, [form.customerId, activeBusiness?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.customerId) throw new Error('Please select a customer');

      const trimmedNumber = form.paymentNumber.trim();
      if (!trimmedNumber) {
        setFieldErrors((prev) => ({ ...prev, paymentNumber: 'Receipt number is required' }));
        throw new Error('Please enter a Receipt Number');
      }

      const amountVal = parseFloat(form.amount);
      if (!form.amount || isNaN(amountVal) || amountVal <= 0) {
        throw new Error('Please enter a valid amount');
      }

      // Check uniqueness of receipt number against other payments
      const taken = await documentNumberTaken({
        table: 'payments',
        column: 'payment_number',
        businessId: activeBusiness.id,
        value: trimmedNumber,
        excludeId: id || undefined,
      }).catch(() => false);

      if (taken) {
        setFieldErrors((prev) => ({
          ...prev,
          paymentNumber: `Receipt number "${trimmedNumber}" already exists`,
        }));
        throw new Error(`Receipt number "${trimmedNumber}" already exists. Please choose a unique number.`);
      }

      const paymentAmount = roundTo2(amountVal);

      // Validate against invoice if selected
      let allocatedAmount = 0;
      let allocatedTo = '';
      let targetInvoice: SalesInvoice | undefined;

      if (form.invoiceId) {
        targetInvoice = invoices.find((i) => i.id === form.invoiceId);
        if (targetInvoice) {
          buildAllocationRequest('sales_invoice', targetInvoice.id, paymentAmount, Number(targetInvoice.balance_amount));
          allocatedAmount = paymentAmount;
          allocatedTo = targetInvoice.invoice_number;
        }
      }

      // Map payment method to valid DB enum/constraint ('cash' | 'upi' | 'bank' | 'card' | 'credit' | 'cheque')
      const paymentMethod = form.payment_method === 'bank_transfer' ? 'bank' : form.payment_method;

      // Recalculate customer balance & total_paid from first principles
      const syncCustomerBalance = async (targetCustomerId: string) => {
        if (!targetCustomerId || !activeBusiness?.id) return;
        try {
          const [custRes, invRes, payRes] = await Promise.all([
            supabase
              .from('customers')
              .select('opening_balance')
              .eq('id', targetCustomerId)
              .maybeSingle(),
            supabase
              .from('sales_invoices')
              .select('grand_total')
              .eq('customer_id', targetCustomerId)
              .in('status', ['issued', 'partially_paid', 'paid']),
            supabase
              .from('payments')
              .select('amount')
              .eq('party_id', targetCustomerId)
              .eq('party_type', 'customer')
              .eq('type', 'received'),
          ]);

          const openingBal = Number(custRes.data?.opening_balance) || 0;
          const totalSales = (invRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.grand_total) || 0), 0);
          let totalPaid = (payRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0);
          if (totalPaid === 0 && paymentAmount > 0 && targetCustomerId === form.customerId) {
            totalPaid = paymentAmount;
          }
          const totalDebit = roundTo2(openingBal + totalSales);
          const newBal = totalDebit <= 0 ? 0 : Math.max(0, roundTo2(totalDebit - totalPaid));

          await supabase
            .from('customers')
            .update({
              current_balance: newBal,
              total_sales: roundTo2(totalSales),
              total_paid: roundTo2(totalPaid),
              last_transaction_date: new Date().toISOString(),
            })
            .eq('id', targetCustomerId);
        } catch (custErr) {
          console.warn('Customer balance update warning:', custErr);
        }
      };

      // If editing an existing payment
      if (id) {
        const previousPartyId = existingPayment?.party_id || (existingPayment as any)?.customer_id;

        const { error: updateError } = await supabase
          .from('payments')
          .update({
            payment_number: trimmedNumber,
            party_id: form.customerId,
            date: form.date,
            payment_date: form.date,
            time: form.time,
            amount: paymentAmount,
            allocated_amount: allocatedAmount,
            invoice_id: form.invoiceId || null,
            payment_method: paymentMethod,
            reference: form.reference?.trim() || null,
            notes: form.notes?.trim() || null,
          })
          .eq('id', id);

        if (updateError) throw updateError;

        // Persist payment_number in payments_received fallback table if present
        try {
          await supabase
            .from('payments')
            .update({
              payment_number: trimmedNumber,
              customer_id: form.customerId,
              amount: paymentAmount,
              date: form.date,
              payment_date: form.date,
              time: form.time,
              payment_method: paymentMethod,
              reference: form.reference?.trim() || null,
              notes: form.notes?.trim() || null,
            })
            .eq('id', id);
        } catch {
          // ignore
        }

        // Sync journal entry via RPC (handles both create and update)
        try {
          await supabase.rpc('sync_payment_received_journal', { p_payment_id: id });
        } catch (journalErr) {
          try {
            await supabase.rpc('post_payment_received_journal', { p_payment_id: id });
          } catch (postErr) {
            console.warn('Journal sync warning:', postErr);
          }
        }

        if (form.invoiceId && targetInvoice) {
          const invPaid = Number(targetInvoice.paid_amount) || 0;
          const invTotal = Number(targetInvoice.grand_total) || 0;
          const newPaid = roundTo2(invPaid + allocatedAmount);
          const newBalance = roundTo2(Math.max(0, invTotal - newPaid));
          const newPaymentStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
          const newStatus = newPaymentStatus === 'paid' ? 'paid' : (targetInvoice.status === 'issued' ? 'partially_paid' : targetInvoice.status);

          await supabase
            .from('sales_invoices')
            .update({
              paid_amount: newPaid,
              balance_amount: newBalance,
              payment_status: newPaymentStatus,
              status: newStatus,
            })
            .eq('id', form.invoiceId);
        }

        // Sync customer balances for current customer and previously linked customer if changed
        if (previousPartyId && previousPartyId !== form.customerId) {
          await syncCustomerBalance(previousPartyId);
        }
        await syncCustomerBalance(form.customerId);

        return {
          allocatedTotal: allocatedAmount,
          allocatedTo,
          isAdvance: form.advanceUnallocated || (!form.invoiceId && allocatedAmount === 0),
          amount: paymentAmount,
          isEdit: true,
        };
      }

      // Direct insert into payments table
      let paymentRow: any = null;
      const { data: insertedPayment, error: insertError } = await supabase
        .from('payments')
        .insert({
          business_id: activeBusiness.id,
          type: 'received',
          party_type: 'customer',
          party_id: form.customerId,
          payment_number: trimmedNumber,
          date: form.date,
          payment_date: form.date,
          time: form.time,
          amount: paymentAmount,
          allocated_amount: allocatedAmount,
          invoice_id: form.invoiceId || null,
          payment_method: paymentMethod,
          reference: form.reference?.trim() || null,
          notes: form.notes?.trim() || null,
        })
        .select()
        .single();

      if (insertError) {
        // Defensive fallback: insert into payments_received table if payments insert fails
          const { data: fallbackRow, error: fallbackErr } = await supabase
            .from('payments')
            .insert({
            business_id: activeBusiness.id,
            customer_id: form.customerId,
            payment_number: trimmedNumber,
            date: form.date,
            payment_date: form.date,
            time: form.time,
            amount: paymentAmount,
            payment_method: paymentMethod,
            reference: form.reference?.trim() || null,
            notes: form.notes?.trim() || null,
            status: 'completed',
          })
          .select()
          .single();

        if (fallbackErr) throw insertError;
        paymentRow = fallbackRow;
      } else {
        paymentRow = insertedPayment;
      }

      // If allocated to an invoice, update sales_invoice row
      if (form.invoiceId && targetInvoice) {
        const invPaid = Number(targetInvoice.paid_amount) || 0;
        const invTotal = Number(targetInvoice.grand_total) || 0;
        const newPaid = roundTo2(invPaid + allocatedAmount);
        const newBalance = roundTo2(Math.max(0, invTotal - newPaid));
        const newPaymentStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
        const newStatus = newPaymentStatus === 'paid' ? 'paid' : (targetInvoice.status === 'issued' ? 'partially_paid' : targetInvoice.status);

        const { error: invUpdateErr } = await supabase
          .from('sales_invoices')
          .update({
            paid_amount: newPaid,
            balance_amount: newBalance,
            payment_status: newPaymentStatus,
            status: newStatus,
          })
          .eq('id', form.invoiceId);

        if (invUpdateErr) {
          console.warn('sales_invoice allocation update warning:', invUpdateErr);
        }
      }

      // Update customer balance & total_paid
      await syncCustomerBalance(form.customerId);

      // Optionally post accounting journal if RPC is available
      if (paymentRow?.id) {
        try {
          await supabase.rpc('sync_payment_received_journal', { p_payment_id: paymentRow.id });
        } catch (journalErr) {
          try {
            await supabase.rpc('post_payment_received_journal', { p_payment_id: paymentRow.id });
          } catch (postErr) {
            console.warn('Journal posting skipped:', postErr);
          }
        }
      }

      const isAdvance = form.advanceUnallocated || (!form.invoiceId && allocatedAmount === 0);
      return {
        allocatedTotal: allocatedAmount,
        allocatedTo,
        isAdvance,
        amount: paymentAmount,
      };
    },
    onSuccess: ({ allocatedTotal, allocatedTo, isAdvance, amount, isEdit }) => {
      queryClient.invalidateQueries({ queryKey: ['payments-received', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['payment', id] });
      queryClient.invalidateQueries({ queryKey: ['customers', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['sales-invoices', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['liquid-cash', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['receivables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['journal-lines-ledger'] });
      queryClient.invalidateQueries({ queryKey: ['liquid-cash', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['receivables', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });

      if (isEdit) {
        toast('Payment updated successfully', 'success');
      } else if (allocatedTo) {
        toast(`Payment recorded — ${formatCurrency(allocatedTotal, activeBusiness?.currency_symbol)} allocated to ${allocatedTo}`, 'success');
      } else if (isAdvance) {
        toast(`Payment of ${formatCurrency(amount, activeBusiness?.currency_symbol)} recorded on account`, 'success');
      } else {
        toast('Payment recorded successfully', 'success');
      }
      navigate('/app/payments-received');
    },
    onError: (err: any) => toast(err?.message || 'Failed to record payment', 'error'),
  });

  return (
    <div>
      <PageHeader
        title={id ? 'Edit Payment' : 'Receive Payment'}
        actions={
          <Button variant="secondary" onClick={() => navigate('/app/payments-received')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      <div className="card p-6 space-y-4">
        {/* Row 1: 3 Columns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Receipt Number" required error={fieldErrors.paymentNumber}>
            <Input
              className="h-10"
              value={form.paymentNumber}
              onChange={(e) => {
                setIsManualNumberEdited(true);
                setForm({ ...form, paymentNumber: e.target.value });
                if (fieldErrors.paymentNumber) {
                  setFieldErrors((prev) => ({ ...prev, paymentNumber: '' }));
                }
              }}
              placeholder={isSuggestingNumber ? 'Suggesting number…' : 'e.g. PR/ABC/SE/26-27/1'}
              aria-label="Receipt Number"
            />
          </FormField>

          <div className="space-y-2">
            <FormField label="Customer" required>
              <Select
                className="input h-10"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value, invoiceId: '' })}
              >
                <option value="">Select customer...</option>
                {customers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {invoices.length > 0 && (
              <FormField label="Against Invoice (optional)">
                <Select
                  className="input h-10"
                  value={form.invoiceId}
                  onChange={(e) => {
                    setForm({ ...form, invoiceId: e.target.value });
                    const inv = invoices.find((i) => i.id === e.target.value);
                    if (inv) setForm((f) => ({ ...f, amount: String(inv.balance_amount) }));
                  }}
                >
                  <option value="">— None (Unallocated) —</option>
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} — Balance: {formatCurrency(inv.balance_amount, activeBusiness?.currency_symbol)}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
          </div>

          <FormField label="Amount" required>
            <Input
              className="h-10"
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder=""
            />
          </FormField>
        </div>

        {/* Row 2: 4 Columns Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label="Date" required>
            <DatePicker
              className="input h-10"
              value={form.date}
              onChange={(date) => setForm({ ...form, date })}
            />
          </FormField>
          <FormField label="Time">
            <TimePicker
              className="h-10"
              value={form.time}
              onChange={(time) => setForm({ ...form, time })}
              placeholder="12:00 PM"
            />
          </FormField>
          <FormField label="Payment Method">
            <Select
              className="input h-10"
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
            </Select>
          </FormField>
          <FormField label="Reference">
            <Input
              className="h-10"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder=""
            />
          </FormField>
        </div>

        {/* Row 3: Notes */}
        <FormField label="Notes">
          <Textarea
            className="min-h-[80px]"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder=""
          />
        </FormField>

        {/* Row 4: Advance / On Account toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Record as Advance / On Account">
            <div className="flex items-center gap-2 h-10 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.advanceUnallocated}
                onChange={(e) => setForm({ ...form, advanceUnallocated: e.target.checked })}
                className="h-4 w-4 accent-primary-600"
              />
              <span className="text-sm text-secondary-600 dark:text-secondary-300">
                Keep unallocated remainder as on-account balance (no open invoice required)
              </span>
            </div>
          </FormField>
        </div>
      </div>

      {/* Action Bar (Bottom) */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/payments-received')}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <Banknote className="h-4 w-4" /> {id ? 'Save Changes' : 'Receive Payment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
