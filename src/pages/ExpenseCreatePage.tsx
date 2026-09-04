import { useState } from 'react';
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
import { todayDateString } from '@/lib/utils';
import type { ExpenseCategory } from '@/types/db';

const emptyForm = {
  category_id: '', date: todayDateString(), description: '', amount: '',
  payment_method: 'cash', reference: '', notes: '',
};

export function ExpenseCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const { data: categories } = useQuery({
    queryKey: ['expense-categories', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('expense_categories').select('*').eq('business_id', activeBusiness.id).order('name');
      return data as ExpenseCategory[];
    },
    enabled: !!activeBusiness,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      if (!form.amount || parseFloat(form.amount) <= 0) throw new Error('Please enter a valid amount');
      const { data: userData } = await supabase.auth.getUser();
      const { data: expenseNumber, error: numberError } = await supabase.rpc('next_document_number', {
        p_business_id: activeBusiness.id,
        p_doc_type: 'expense',
        p_date: form.date,
      });
      if (numberError) throw numberError;
      const { data: expense, error } = await supabase.from('expenses').insert({
        business_id: activeBusiness.id,
        expense_number: String(expenseNumber),
        category_id: form.category_id || null,
        date: form.date,
        description: form.description || null,
        amount: parseFloat(form.amount),
        tax_amount: 0,
        total_amount: parseFloat(form.amount),
        payment_method: form.payment_method,
        reference: form.reference || null,
        notes: form.notes || null,
        created_by: userData.user?.id,
      }).select('id').single();
      if (error) throw error;

      const { error: jeError } = await supabase.rpc('post_expense_journal', {
        p_expense_id: expense.id,
      });
      if (jeError) {
        await supabase.from('expenses').delete().eq('id', expense.id);
        throw jeError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['cashflow-series', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['liquid-cash', activeBusiness?.id] });
      toast('Expense recorded successfully', 'success');
      navigate('/app/expenses');
    },
    onError: (err: any) => toast(err.message || 'Failed to record expense', 'error'),
  });

  return (
    <div>
      <PageHeader
        title="New Expense"
        actions={<Button variant="secondary" onClick={() => navigate('/app/expenses')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Expense Details">
          <div className="space-y-4 max-w-xl">
            <FormField label="Category">
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Select category...</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Amount" required><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></FormField>
              <FormField label="Date" required><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} /></FormField>
            </div>
            <FormField label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Expense description..." /></FormField>
          </div>
        </FormSection>

        <FormSection title="Payment">
          <div className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Payment Method">
                <select className="input" value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
                  <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="card">Card</option>
                </select>
              </FormField>
              <FormField label="Reference"><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></FormField>
            </div>
            <FormField label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></FormField>
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/expenses')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            <Save className="h-4 w-4" /> Save Expense
          </Button>
        </div>
      </div>
    </div>
  );
}
