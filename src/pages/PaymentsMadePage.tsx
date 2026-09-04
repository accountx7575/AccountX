import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { CreditCard, Plus, Search, Send } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { SendDialog } from '@/components/comms/SendDialog';
import { Tooltip } from '@/components/ui/Tooltip';
import type { Payment } from '@/types/db';

export function PaymentsMadePage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [unappliedOnly, setUnappliedOnly] = useState(false);
  const [sendTarget, setSendTarget] = useState<(Payment & { supplier: { name: string; email: string | null; phone: string | null } | null }) | null>(null);

  const { data: payments, isLoading, isError, refetch } = useQuery({
    queryKey: ['payments-made', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase.from('payments').select('*, supplier:suppliers(name,email,phone)')
        .eq('business_id', activeBusiness.id).eq('type', 'made').order('created_at', { ascending: false });
      return data as (Payment & { supplier: { name: string; email: string | null; phone: string | null } | null })[];
    },
    enabled: !!activeBusiness,
  });

  const filtered = useMemo(() => {
    if (!payments) return [];
    return payments.filter((p) => {
      if (unappliedOnly && Math.round((p.amount - p.allocated_amount) * 100) <= 0) return false;
      return p.payment_number.toLowerCase().includes(search.toLowerCase()) ||
        (p.supplier?.name || '').toLowerCase().includes(search.toLowerCase());
    });
  }, [payments, search, unappliedOnly]);

  return (
    <div>
      <PageHeader title="Payment Made" subtitle={`${filtered.length} payment${filtered.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={() => navigate('/app/payments-made/new')}><Plus className="h-4 w-4" /> Make Payment</Button>} />

      <div className="card">
        <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[12rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
            <Input placeholder="Search payments..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
          <Button size="sm" variant={unappliedOnly ? 'primary' : 'secondary'} onClick={() => setUnappliedOnly(!unappliedOnly)}
            title="Show only payments with an unallocated remainder">
            Unapplied only
          </Button>
        </div>
        {isError ? (
          <ErrorState title="Unable to load payments made." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="p-8 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={CreditCard} title="No payments made yet" description="Record payments to your suppliers" action={<Button onClick={() => navigate('/app/payments-made/new')}><Plus className="h-4 w-4" /> Make Payment</Button>} />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-secondary-200 dark:border-secondary-800 text-secondary-500 dark:text-secondary-400">
                  <th className="text-left px-4 py-3 font-medium">Payment No.</th>
                  <th className="text-left px-4 py-3 font-medium">Supplier</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Method</th>
                  <th className="text-right px-4 py-3 font-medium">Amount</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-b border-secondary-100 dark:border-secondary-800/50 table-row-hover">
                    <td className="px-4 py-3 font-medium text-error-600 dark:text-error-400">{p.payment_number}</td>
                    <td className="px-4 py-3 text-secondary-900 dark:text-secondary-100">{p.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-secondary-500">{formatDate(p.date)}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-secondary-600 dark:text-secondary-300 uppercase text-xs">{p.payment_method}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="tabular-nums font-medium text-error-600 dark:text-error-400">{formatCurrency(p.amount, activeBusiness?.currency_symbol)}</div>
                      {Math.round((p.amount - p.allocated_amount) * 100) > 0 && (
                        <span className="badge bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300 mt-0.5">
                          Unapplied {formatCurrency(Math.round((p.amount - p.allocated_amount) * 100) / 100, activeBusiness?.currency_symbol)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Tooltip label="Send payment advice to the supplier">
                        <Button size="sm" variant="ghost" onClick={() => setSendTarget(p)}>
                          <Send className="h-3.5 w-3.5" /> Advice
                        </Button>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supplier-side payment advice. doc_type 'payment_made' + seeded
          templates are LIVE (059 Part D: CHECK widened, email+in_app seeds
          using exactly these variables). defaultSubject/defaultMessage stay
          as the safety net if the template fetch misses or fails - the
          dialog prefers the stored template when one resolves. */}
      <SendDialog
        open={!!sendTarget}
        onClose={() => setSendTarget(null)}
        contextLabel={`Payment ${sendTarget?.payment_number ?? ''}`}
        docType="payment_made"
        docId={sendTarget?.id}
        docNumber={sendTarget?.payment_number}
        templateKey="payment_made"
        templateVariables={{
          supplier_name: sendTarget?.supplier?.name || '',
          business_name: activeBusiness?.name || '',
          amount: formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol),
        }}
        defaultSubject={`Payment sent — ${sendTarget?.payment_number ?? ''}`}
        defaultMessage={`Dear ${sendTarget?.supplier?.name || 'supplier'}, this is to confirm we have sent a payment of ${formatCurrency(Number(sendTarget?.amount || 0), activeBusiness?.currency_symbol)} (ref ${sendTarget?.payment_number ?? ''}). Thank you for your partnership.`}
        recipients={[
          {
            label: sendTarget?.supplier?.name || 'Supplier on record',
            email: sendTarget?.supplier?.email,
            phone: sendTarget?.supplier?.phone,
          },
        ]}
      />
    </div>
  );
}
