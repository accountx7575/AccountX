import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { formatCurrency, formatDate, todayDateString, roundTo2 } from '@/lib/utils';
import { postJournalEntry, validateLines } from '@/lib/accounting';
import { buildJournalLines } from '@/lib/payloads';
import type { JournalEntry, Account } from '@/types/db';
import { PageMotion, listContainer, listItem } from '@/lib/motion';
import { motion, useReducedMotion } from 'framer-motion';

type Line = { account_id: string; debit: string; credit: string };

export function JournalEntriesPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const { data: entries, isLoading, isError, refetch } = useQuery({
    queryKey: ['journal-entries', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('journal_entries').select('*, lines:journal_entry_lines(*)')
        .eq('business_id', activeBusiness.id).order('created_at', { ascending: false }).limit(50);
      return data as (JournalEntry & { lines: any[] })[];
    },
    enabled: !!activeBusiness,
  });

  const sym = activeBusiness?.currency_symbol || '₹';
  const reduce = useReducedMotion();

  return (
    <PageMotion>
      <PageHeader title="Journal Entries" subtitle="Double-entry journal vouchers"
        actions={<Button onClick={() => navigate('/app/journal-entries/new')}><Plus className="h-4 w-4" /> New Entry</Button>} />

      {isError ? (
        <ErrorState title="Unable to load journal entries." onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="card p-8 space-y-3">{[1,2,3,4].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
      ) : !entries || entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No journal entries yet" description="Create double-entry journal vouchers" action={<Button onClick={() => navigate('/app/journal-entries/new')}><Plus className="h-4 w-4" /> New Entry</Button>} />
      ) : (
        <motion.div
          className="space-y-3"
          variants={reduce ? undefined : listContainer}
          initial="initial"
          animate="animate"
        >
          {entries.map((e) => (
            <motion.div key={e.id} variants={reduce ? undefined : listItem} className="card p-4">
              <div className="flex items-center gap-3 mb-3 pb-3 border-b border-secondary-100 dark:border-secondary-800">
                <span className="inline-flex items-center rounded-md bg-secondary-100 dark:bg-secondary-800 px-2 py-1 text-xs font-bold figure text-secondary-700 dark:text-secondary-300">
                  {e.entry_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-secondary-400">{formatDate(e.date)}</p>
                  <p className="text-sm text-secondary-600 dark:text-secondary-400 truncate">{e.narration || 'No narration'}</p>
                </div>
                <Badge variant={e.status === 'posted' ? 'success' : 'neutral'}>{e.status}</Badge>
              </div>
              <div className="overflow-x-auto scrollbar-thin pl-2 sm:pl-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-secondary-400 text-xs">
                      <th className="text-left py-1 font-medium">Account</th>
                      <th className="text-right py-1 font-medium">Debit</th>
                      <th className="text-right py-1 font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l: any) => (
                      <tr key={l.id} className="border-t border-secondary-100 dark:border-secondary-800/50">
                        <td className="py-2">
                          <span className="inline-flex items-center rounded-md bg-secondary-100/80 dark:bg-secondary-800 px-2 py-0.5 text-xs font-medium text-secondary-700 dark:text-secondary-300">
                            {l.account_name}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums figure">{Number(l.debit_amount) > 0 ? formatCurrency(l.debit_amount, sym) : '—'}</td>
                        <td className="py-2 text-right tabular-nums figure">{Number(l.credit_amount) > 0 ? formatCurrency(l.credit_amount, sym) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

    </PageMotion>
  );
}
