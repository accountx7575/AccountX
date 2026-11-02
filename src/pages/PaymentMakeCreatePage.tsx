import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { formatCurrency, todayDateString, roundTo2, isUuid } from '@/lib/utils';
import { buildAllocationRequest } from '@/lib/payloads';
import { allocateDocumentNumber } from '@/lib/numbering';
import type { Supplier, PurchaseBill, Payment } from '@/types/db';

export function PaymentMakeCreatePage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    supplierId: '', billId: '', amount: '', date: todayDateString(),
    payment_method: 'cash', reference: '', notes: '', advanceUnallocated: false,
  });
  const [bills, setBills] = useState<PurchaseBill[]>([]);

  const { data: existingPayment } = useQuery({
    queryKey: ['payment-made', id],
    queryFn: async () => {
      if (!id) return null;
      let { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!data) {
        const alt = await supabase
          .from('payments_made')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (alt.data) data = alt.data;
      }
      if (error && !data) throw error;
      return data as Payment;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (existingPayment) {
      setForm({
        supplierId: existingPayment.party_id || (existingPayment as any).supplier_id || '',
        billId: existingPayment.bill_id || '',
        amount: String(existingPayment.amount ?? ''),
        date: existingPayment.payment_date || existingPayment.date || todayDateString(),
        payment_method: existingPayment.payment_method || 'cash',
        reference: existingPayment.reference || '',
        notes: existingPayment.notes || '',
        advanceUnallocated: !existingPayment.bill_id,
      });
    }
  }, [existingPayment]);

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
      Promise.resolve(
        supabase
          .from('purchase_bills')
          .select('*')
          .eq('business_id', activeBusiness.id)
          .eq('supplier_id', form.supplierId)
          .order('bill_date', { ascending: false })
          .then(({ data, error }) => {
            if (error) throw error;
            const openOrCurrentBills = (data || []).filter(
              (b: any) =>
                ['confirmed', 'partially_paid'].includes(b.status) &&
                (Number(b.balance_amount) > 0 || (isEdit && b.id === existingPayment?.bill_id))
            );
            setBills(openOrCurrentBills as PurchaseBill[]);
          })
      ).catch((err: any) => toast(err?.message || 'Failed to load open bills', 'error'));
    } else {
      setBills([]);
    }
  }, [form.supplierId, activeBusiness, isEdit, existingPayment?.bill_id]);

  const syncSupplierBalance = async (targetSupplierId: string) => {
    if (!targetSupplierId || !activeBusiness?.id || !isUuid(targetSupplierId)) return;
    try {
      const [suppRes, billsRes, payRes] = await Promise.all([
        supabase
          .from('suppliers')
          .select('opening_balance')
          .eq('id', targetSupplierId)
          .eq('business_id', activeBusiness.id)
          .maybeSingle(),
        supabase
          .from('purchase_bills')
          .select('grand_total')
          .eq('supplier_id', targetSupplierId)
          .eq('business_id', activeBusiness.id)
          .in('status', ['confirmed', 'partially_paid', 'paid']),
        supabase
          .from('payments')
          .select('amount')
          .eq('party_id', targetSupplierId)
          .eq('party_type', 'supplier')
          .eq('business_id', activeBusiness.id)
          .eq('type', 'made'),
      ]);

      const openingBal = Number(suppRes.data?.opening_balance) || 0;
      const totalPurchases = (billsRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.grand_total) || 0), 0);
      const totalPaid = (payRes.data || []).reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0);
      const totalPayable = roundTo2(openingBal + totalPurchases);
      const newBal = totalPayable <= 0 ? 0 : Math.max(0, roundTo2(totalPayable - totalPaid));

      await supabase
        .from('suppliers')
        .update({
          current_balance: newBal,
          total_purchases: roundTo2(totalPurchases),
          total_paid: roundTo2(totalPaid),
          last_transaction_date: new Date().toISOString(),
        })
        .eq('id', targetSupplierId)
        .eq('business_id', activeBusiness.id);
    } catch (suppErr) {
      console.warn('supplier balance update warning:', suppErr);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.supplierId) throw new Error('Please select a supplier');
      const amountVal = parseFloat(form.amount);
      if (!form.amount || isNaN(amountVal) || amountVal <= 0) {
        throw new Error('Please enter a valid amount');
      }

      const paymentAmount = roundTo2(amountVal);

      // Validate against bill if selected
      let allocatedAmount = 0;
      let allocatedTo = '';
      let targetBill: PurchaseBill | undefined;

      if (form.billId) {
        targetBill = bills.find((b) => b.id === form.billId);
        if (targetBill) {
          buildAllocationRequest('purchase_bill', targetBill.id, paymentAmount, Number(targetBill.balance_amount));
          allocatedAmount = paymentAmount;
          allocatedTo = targetBill.bill_number;
        }
      }

      const paymentMethod = form.payment_method === 'bank_transfer' ? 'bank' : form.payment_method;

      // Handle Edit Mode
      if (isEdit && id) {
        const previousSupplierId = existingPayment?.party_id || (existingPayment as any)?.supplier_id;
        const previousBillId = existingPayment?.bill_id;
        const previousAllocated = Number(existingPayment?.allocated_amount) || Number(existingPayment?.amount) || 0;

        // If previously allocated to a different bill, revert the old bill
        if (previousBillId && previousBillId !== form.billId && isUuid(previousBillId)) {
          try {
            const { data: prevBill } = await supabase
              .from('purchase_bills')
              .select('paid_amount, grand_total, status')
              .eq('id', previousBillId)
              .maybeSingle();

            if (prevBill) {
              const curPaid = Number(prevBill.paid_amount) || 0;
              const gTotal = Number(prevBill.grand_total) || 0;
              const revertedPaid = roundTo2(Math.max(0, curPaid - previousAllocated));
              const revertedBal = roundTo2(Math.min(gTotal, gTotal - revertedPaid));
              const revertedPayStatus = revertedBal <= 0 ? 'paid' : (revertedPaid > 0 ? 'partial' : 'unpaid');
              const revertedStatus = revertedPayStatus === 'paid' ? 'paid' : (revertedPaid > 0 ? 'partially_paid' : 'confirmed');
              await supabase.from('purchase_bills').update({
                paid_amount: revertedPaid,
                balance_amount: revertedBal,
                payment_status: revertedPayStatus,
                status: revertedStatus,
              }).eq('id', previousBillId);
            }
          } catch (prevBillErr) {
            console.warn('revert previous bill allocation warning:', prevBillErr);
          }
        }

        // Update payment row in payments
        const { error: updateError } = await supabase
          .from('payments')
          .update({
            party_id: form.supplierId,
            date: form.date,
            payment_date: form.date,
            amount: paymentAmount,
            allocated_amount: allocatedAmount,
            bill_id: form.billId || null,
            payment_method: paymentMethod,
            reference: form.reference?.trim() || null,
            notes: form.notes?.trim() || null,
          })
          .eq('id', id);

        if (updateError) throw updateError;

        // If allocated to a bill, update purchase_bills row
        if (form.billId && targetBill) {
          const prevAllocatedToThis = (previousBillId === form.billId) ? previousAllocated : 0;
          const basePaid = Math.max(0, (Number(targetBill.paid_amount) || 0) - prevAllocatedToThis);
          const billTotal = Number(targetBill.grand_total) || 0;
          const newPaid = roundTo2(basePaid + allocatedAmount);
          const newBalance = roundTo2(Math.max(0, billTotal - newPaid));
          const newPaymentStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
          const newStatus = newPaymentStatus === 'paid' ? 'paid' : (targetBill.status === 'confirmed' ? 'partially_paid' : targetBill.status);

          await supabase
            .from('purchase_bills')
            .update({
              paid_amount: newPaid,
              balance_amount: newBalance,
              payment_status: newPaymentStatus,
              status: newStatus,
            })
            .eq('id', form.billId);
        }

        // Sync supplier balance for previous supplier (if changed) and new supplier
        if (previousSupplierId && previousSupplierId !== form.supplierId) {
          await syncSupplierBalance(previousSupplierId);
        }
        await syncSupplierBalance(form.supplierId);

        // Update journal entries
        try {
          const { data: jeList } = await supabase
            .from('journal_entries')
            .select('id')
            .eq('business_id', activeBusiness.id)
            .eq('reference_type', 'payment_made')
            .eq('reference_id', id);

          if (jeList && jeList.length > 0) {
            for (const je of jeList) {
              await supabase
                .from('journal_entries')
                .update({
                  entry_date: form.date,
                  narration: `Payment made ${existingPayment?.payment_number || ''}`.trim(),
                })
                .eq('id', je.id);

              const { data: lines } = await supabase
                .from('journal_entry_lines')
                .select('id, debit_amount, credit_amount')
                .eq('entry_id', je.id);

              if (lines) {
                for (const line of lines) {
                  if (Number(line.debit_amount) > 0) {
                    await supabase.from('journal_entry_lines').update({ debit_amount: paymentAmount }).eq('id', line.id);
                  }
                  if (Number(line.credit_amount) > 0) {
                    await supabase.from('journal_entry_lines').update({ credit_amount: paymentAmount }).eq('id', line.id);
                  }
                }
              }
            }
          } else {
            await supabase.rpc('post_payment_made_journal', { p_payment_id: id });
          }
        } catch (jeErr) {
          console.warn('journal update warning:', jeErr);
        }

        const isAdvance = form.advanceUnallocated || (!form.billId && allocatedAmount === 0);
        return {
          allocatedTotal: allocatedAmount,
          allocatedTo,
          isAdvance,
          amount: paymentAmount,
          isEdit: true,
        };
      }

      // Create Mode
      let paymentNumber = '';
      try {
        paymentNumber = await allocateDocumentNumber({
          businessId: activeBusiness.id,
          docType: 'payment_made',
          table: 'payments',
          numberColumn: 'payment_number',
          date: form.date,
        });
      } catch (numErr) {
        console.warn('allocateDocumentNumber fallback engaged:', numErr);
        const yr = form.date ? new Date(form.date).getFullYear() : new Date().getFullYear();
        paymentNumber = `PAY/${yr}/${String(Date.now()).slice(-6)}`;
      }

      // Direct insert into payments table
      const { data: paymentRow, error: insertError } = await supabase
        .from('payments')
        .insert({
          business_id: activeBusiness.id,
          type: 'made',
          party_type: 'supplier',
          party_id: form.supplierId,
          payment_number: paymentNumber,
          date: form.date,
          payment_date: form.date,
          amount: paymentAmount,
          allocated_amount: allocatedAmount,
          bill_id: form.billId || null,
          payment_method: paymentMethod,
          reference: form.reference?.trim() || null,
          notes: form.notes?.trim() || null,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // If allocated to a bill, update purchase_bills row
      if (form.billId && targetBill) {
        const billPaid = Number(targetBill.paid_amount) || 0;
        const billTotal = Number(targetBill.grand_total) || 0;
        const newPaid = roundTo2(billPaid + allocatedAmount);
        const newBalance = roundTo2(Math.max(0, billTotal - newPaid));
        const newPaymentStatus = newBalance <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'unpaid');
        const newStatus = newPaymentStatus === 'paid' ? 'paid' : (targetBill.status === 'confirmed' ? 'partially_paid' : targetBill.status);

        const { error: billUpdateErr } = await supabase
          .from('purchase_bills')
          .update({
            paid_amount: newPaid,
            balance_amount: newBalance,
            payment_status: newPaymentStatus,
            status: newStatus,
          })
          .eq('id', form.billId);

        if (billUpdateErr) {
          console.warn('purchase_bills allocation update warning:', billUpdateErr);
        }
      }

      // Update supplier balance & total_paid
      await syncSupplierBalance(form.supplierId);

      // Optionally post accounting journal if RPC is available
      if (paymentRow?.id) {
        try {
          await supabase.rpc('post_payment_made_journal', { p_payment_id: paymentRow.id });
        } catch (journalErr) {
          console.warn('post_payment_made_journal skipped:', journalErr);
        }
      }

      const isAdvance = form.advanceUnallocated || (!form.billId && allocatedAmount === 0);
      return {
        allocatedTotal: allocatedAmount,
        allocatedTo,
        isAdvance,
        amount: paymentAmount,
        isEdit: false,
      };
    },
    onSuccess: ({ allocatedTotal, allocatedTo, isAdvance, amount, isEdit }) => {
      queryClient.invalidateQueries({ queryKey: ['payments-made'] });
      queryClient.invalidateQueries({ queryKey: ['payment-made', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-bills'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-series'] });
      queryClient.invalidateQueries({ queryKey: ['liquid-cash'] });
      queryClient.invalidateQueries({ queryKey: ['payables'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });

      if (isEdit) {
        toast('Payment updated successfully', 'success');
      } else if (allocatedTo) {
        toast(`Payment recorded — ${formatCurrency(allocatedTotal, activeBusiness?.currency_symbol)} allocated to ${allocatedTo}`, 'success');
      } else if (isAdvance) {
        toast(`Payment of ${formatCurrency(amount, activeBusiness?.currency_symbol)} recorded on account`, 'success');
      } else {
        toast('Payment recorded successfully', 'success');
      }
      navigate('/app/payments-made');
    },
    onError: (err: any) => toast(err?.message || (isEdit ? 'Failed to update payment' : 'Failed to record payment'), 'error'),
  });

  return (
    <div>
      <PageHeader
        title={isEdit ? (existingPayment?.payment_number ? `Edit Payment (${existingPayment.payment_number})` : 'Edit Payment') : 'Make Payment'}
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
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
              <FormField label="Amount" required><Input className="h-10" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></FormField>
              <FormField label="Date" required><DatePicker className="input h-10" value={form.date} onChange={(date) => setForm({ ...form, date })} /></FormField>
              <FormField label="Payment Method">
                <select className="input h-10" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="card">Card</option><option value="cheque">Cheque</option>
                </select>
              </FormField>
              <FormField label="Reference"><Input className="h-10" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="UTR / Cheque No." /></FormField>
            </div>
            <FormField label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></FormField>
          </div>
        </FormSection>

        {/* Advance / On Account toggle */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <FormField label="Record as Advance / On Account">
            <div className="flex items-center gap-2 h-10 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.advanceUnallocated}
                onChange={(e) => setForm({ ...form, advanceUnallocated: e.target.checked })}
                className="h-4 w-4 accent-primary-600"
              />
              <span className="text-sm text-secondary-600 dark:text-secondary-300">
                Keep unallocated remainder as on-account balance (no open bill required)
              </span>
            </div>
          </FormField>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/payments-made')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <CreditCard className="h-4 w-4" /> {isEdit ? 'Update Payment' : 'Make Payment'}
          </Button>
        </div>
      </div>
    </div>
  );
}
