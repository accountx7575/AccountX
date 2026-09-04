import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, FormField, Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Landmark, Plus, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Account } from '@/types/db';
import { PageMotion, listContainer, listItem } from '@/lib/motion';
import { motion, useReducedMotion } from 'framer-motion';

const GROUPS = ['Current Assets', 'Fixed Assets', 'Current Liabilities', 'Long-term Liabilities', 'Capital Account', 'Direct Income', 'Indirect Income', 'Direct Expense', 'Indirect Expense', 'Sundry Debtors', 'Sundry Creditors', 'Cash & Bank'];

const emptyForm = { name: '', group_name: 'Current Assets', code: '', opening_balance: '0' };

export function ChartOfAccountsPage() {
  const { activeBusiness } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: accounts, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounts', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('accounts').select('*').eq('business_id', activeBusiness.id).order('group_name').order('name');
      return data as Account[];
    },
    enabled: !!activeBusiness,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBusiness) throw new Error('No active business');
      const payload = {
        business_id: activeBusiness.id,
        name: form.name,
        group_name: form.group_name,
        code: form.code || null,
        opening_balance: parseFloat(form.opening_balance) || 0,
        current_balance: parseFloat(form.opening_balance) || 0,
      };
      if (editing) {
        const { error } = await supabase.from('accounts').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounts').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      toast(editing ? 'Account updated' : 'Account created', 'success');
      setDrawerOpen(false);
    },
    onError: (err: any) => toast(err.message || 'Failed to save', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts', activeBusiness?.id] });
      toast('Account deleted', 'success');
    },
    onError: (err: any) => toast(err.message || 'Failed to delete', 'error'),
  });

  const grouped = useMemo(() => {
    if (!accounts) return {};
    return accounts.reduce((acc, a) => {
      if (!acc[a.group_name]) acc[a.group_name] = [];
      acc[a.group_name].push(a);
      return acc;
    }, {} as Record<string, Account[]>);
  }, [accounts]);

  const openNew = () => { setEditing(null); setForm(emptyForm); setDrawerOpen(true); };
  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({ name: a.name, group_name: a.group_name, code: a.code || '', opening_balance: String(a.opening_balance) });
    setDrawerOpen(true);
  };
  const reduce = useReducedMotion();

  return (
    <PageMotion>
      <PageHeader title="Chart of Accounts" subtitle={`${accounts?.length || 0} ledger accounts`}
        actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add Account</Button>} />

      {isError ? (
        <ErrorState title="Unable to load chart of accounts." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="card p-8 space-y-3">{[1,2,3,4,5].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
      ) : !accounts || accounts.length === 0 ? (
        <EmptyState icon={Landmark} title="No accounts yet" description="Create ledger accounts for your chart of accounts" action={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add Account</Button>} />
      ) : (
        <motion.div
          className="space-y-4"
          variants={reduce ? undefined : listContainer}
          initial="initial"
          animate="animate"
        >
          {Object.entries(grouped).map(([group, accts]) => (
            <motion.div key={group} variants={reduce ? undefined : listItem} className="card">
              <div className="px-4 py-3 border-b border-secondary-200 dark:border-secondary-800">
                <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">{group}</h3>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-secondary-100 dark:border-secondary-800/50 text-secondary-500 dark:text-secondary-400">
                      <th className="text-left px-4 py-2 font-medium">Name</th>
                      <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Code</th>
                      <th className="text-right px-4 py-2 font-medium">Opening</th>
                      <th className="text-right px-4 py-2 font-medium">Current Balance</th>
                      <th className="text-center px-4 py-2 font-medium">Type</th>
                      <th className="text-right px-4 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accts.map((a) => (
                      <tr key={a.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                        <td className="px-4 py-2 font-medium text-secondary-900 dark:text-secondary-100">{a.name}</td>
                        <td className="px-4 py-2 hidden sm:table-cell text-secondary-500 font-mono text-xs">{a.code || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums figure text-secondary-500">{formatCurrency(a.opening_balance, activeBusiness?.currency_symbol)}</td>
                        <td className="px-4 py-2 text-right tabular-nums figure font-medium text-secondary-900 dark:text-secondary-100">
                          {formatCurrency(Math.abs(Number(a.current_balance)), activeBusiness?.currency_symbol)}{' '}
                          <span className={Number(a.current_balance) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{Number(a.current_balance) >= 0 ? 'Dr' : 'Cr'}</span>
                        </td>
                        <td className="px-4 py-2 text-center">{a.is_system ? <Badge variant="info">System</Badge> : <Badge variant="neutral">Custom</Badge>}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(a)} className="p-1.5 rounded-md text-secondary-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/30"><Pencil className="h-3.5 w-3.5" /></button>
                            {!a.is_system && <button onClick={() => deleteMutation.mutate(a.id)} className="p-1.5 rounded-md text-secondary-400 hover:text-error-600 hover:bg-error-50 dark:hover:bg-error-900/30"><Trash2 className="h-3.5 w-3.5" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'Edit Account' : 'Add Account'}
        footer={<div className="flex gap-2"><Button variant="secondary" onClick={() => setDrawerOpen(false)} className="flex-1">Cancel</Button><Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending} className="flex-1">{editing ? 'Update' : 'Save'}</Button></div>}>
        <div className="space-y-4">
          <FormField label="Account Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cash In Hand" /></FormField>
          <FormField label="Group" required>
            <Select value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })}>
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1001" /></FormField>
            <FormField label="Opening Balance"><Input type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></FormField>
          </div>
        </div>
      </Drawer>
    </PageMotion>
  );
}
