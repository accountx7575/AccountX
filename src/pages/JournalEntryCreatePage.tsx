import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/common/DatePicker';
import { Input, FormField, Select } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { formatCurrency, todayDateString, roundTo2 } from '@/lib/utils';
import { postJournalEntry, validateLines } from '@/lib/accounting';
import { buildJournalLines } from '@/lib/payloads';
import type { Account } from '@/types/db';

type Line = { account_id: string; debit: string; credit: string };

const emptyForm = {
  date: todayDateString(), narration: '', lines: [{ account_id: '', debit: '', credit: '' }, { account_id: '', debit: '', credit: '' }] as Line[],
};

export function JournalEntryCreatePage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const { data: accounts } = useQuery({
    queryKey: ['accounts', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('accounts').select('*').eq('business_id', activeBusiness.id).order('name');
      return data as Account[];
    },
    enabled: !!activeBusiness,
  });

  const totalDebit = useMemo(() => form.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0), [form.lines]);
  const totalCredit = useMemo(() => form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0), [form.lines]);
  const isBalanced = roundTo2(totalDebit) === roundTo2(totalCredit) && totalDebit > 0;

  const updateLine = (idx: number, updates: Partial<Line>) => {
    setForm((prev) => ({ ...prev, lines: prev.lines.map((l, i) => i === idx ? { ...l, ...updates } : l) }));
  };
  const addLine = () => setForm((prev) => ({ ...prev, lines: [...prev.lines, { account_id: '', debit: '', credit: '' }] }));
  const removeLine = (idx: number) => setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const lines = buildJournalLines(form.lines);
      const validationError = validateLines(lines);
      if (validationError) throw new Error(validationError);

      await postJournalEntry({
        business_id: activeBusiness.id,
        date: form.date,
        narration: form.narration || null,
        lines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['journal-lines-ledger', activeBusiness?.id] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance', activeBusiness?.id] });
      toast('Journal entry posted successfully', 'success');
      navigate('/app/journal-entries');
    },
    onError: (err: any) => toast(err.message || 'Failed to post entry', 'error'),
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  return (
    <div>
      <PageHeader
        title="New Journal Entry"
        actions={<Button variant="secondary" onClick={() => navigate('/app/journal-entries')}><ArrowLeft className="h-4 w-4" /> Back</Button>}
      />

      <div className="card p-6">
        <FormSection title="Voucher" description="Double-entry check runs live as you type">
          <div className="space-y-4 max-w-3xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Date" required><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} /></FormField>
              <div>
                <label className="label">Balance Check</label>
                <div className={`text-sm font-medium px-3 py-2 rounded-lg ${isBalanced ? 'bg-success-50 dark:bg-success-900/30 text-success-700 dark:text-success-300' : 'bg-error-50 dark:bg-error-900/30 text-error-700 dark:text-error-300'}`}>
                  Dr: {formatCurrency(totalDebit, sym)} | Cr: {formatCurrency(totalCredit, sym)} {isBalanced ? '✓' : '✗'}
                </div>
              </div>
            </div>
            <FormField label="Narration"><Input value={form.narration} onChange={(e) => setForm({ ...form, narration: e.target.value })} placeholder="Being..." /></FormField>
          </div>
        </FormSection>

        <FormSection
          title="Entry Lines"
          description="Enter either a debit or a credit per line; totals must balance before posting"
          actions={
            <button onClick={addLine} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"><Plus className="h-4 w-4" /> Add Line</button>
          }
        >
          <div className="space-y-2 max-w-3xl">
            {form.lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6">
                  <Select value={l.account_id} onChange={(e) => updateLine(idx, { account_id: e.target.value })}>
                    <option value="">Select account...</option>
                    {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-2"><Input type="number" placeholder="Debit" value={l.debit} onChange={(e) => updateLine(idx, { debit: e.target.value, credit: '' })} className="text-right figure" /></div>
                <div className="col-span-2"><Input type="number" placeholder="Credit" value={l.credit} onChange={(e) => updateLine(idx, { credit: e.target.value, debit: '' })} className="text-right figure" /></div>
                <div className="col-span-2 flex justify-center">
                  {form.lines.length > 2 && <button onClick={() => removeLine(idx)} className="p-1.5 text-secondary-400 hover:text-error-600" title="Remove line"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        </FormSection>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mt-5 border-t border-secondary-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={() => navigate('/app/journal-entries')}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!isBalanced}>
            Post Entry
          </Button>
        </div>
      </div>
    </div>
  );
}
