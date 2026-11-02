import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import type { AiBusinessSnapshot } from '@/types/ai';

/**
 * Real supporting figures under an AI answer — every number comes straight
 * from get_ai_business_snapshot (migration 045). Nothing here is invented:
 * if the snapshot has no data the strip renders nothing at all.
 */
export function AnswerKeyFigures({ businessId }: { businessId: string }) {
  const snapQ = useQuery({
    queryKey: ['ai-business-snapshot', businessId],
    queryFn: async (): Promise<AiBusinessSnapshot | null> => {
      const { data, error } = await supabase.rpc('get_ai_business_snapshot', {
        p_business_id: businessId,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as AiBusinessSnapshot) ?? null;
    },
    staleTime: 30_000,
  });

  const snap = snapQ.data;
  if (!snap?.kpis) return null;
  const k = snap.kpis;

  // Real month-over-month delta from the snapshot's own sales series.
  let salesDelta: { pct: number; dir: 'up' | 'down' } | null = null;
  if (snap.sales_monthly && snap.sales_monthly.length >= 2) {
    const cur = snap.sales_monthly[snap.sales_monthly.length - 1];
    const prev = snap.sales_monthly[snap.sales_monthly.length - 2];
    if (prev.total > 0 && cur.month !== prev.month) {
      const pct = Math.round(((cur.total - prev.total) / prev.total) * 100);
      if (Number.isFinite(pct) && pct !== 0) salesDelta = { pct, dir: pct > 0 ? 'up' : 'down' };
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-secondary-100 dark:border-secondary-800 bg-secondary-50/60 dark:bg-secondary-800/40 p-3" aria-label="Key figures from your books">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <p className="text-caption font-medium uppercase tracking-[0.06em]">Receivables outstanding</p>
          <p className="font-sans font-semibold text-xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
            {formatCurrency(k.receivables_outstanding)}
          </p>
          <p className="text-[11px] text-secondary-400">
            Overdue: {formatCurrency(k.receivables_overdue)}
          </p>
        </div>
        <div>
          <p className="text-caption font-medium uppercase tracking-[0.06em]">
            Sales · {snap.sales_monthly?.length ? snap.sales_monthly[snap.sales_monthly.length - 1].month : 'this month'}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-sans font-semibold text-xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
              {formatCurrency(snap.sales_monthly?.length ? snap.sales_monthly[snap.sales_monthly.length - 1].total : k.sales_total)}
            </span>
            {salesDelta && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                  salesDelta.dir === 'up'
                    ? 'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-400'
                    : 'bg-error-50 text-error-600 dark:bg-error-900/30 dark:text-error-400'
                }`}
              >
                {salesDelta.dir === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                <span className="tabular-nums">{Math.abs(salesDelta.pct)}%</span>
              </span>
            )}
          </div>
          <p className="text-[11px] text-secondary-400">vs previous month</p>
        </div>
        <div>
          <p className="text-caption font-medium uppercase tracking-[0.06em]">Cash position</p>
          <p className="font-sans font-semibold text-xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">
            {formatCurrency(snap.cash_position?.total ?? k.cash_in_hand + k.bank_balance)}
          </p>
          <p className="text-[11px] text-secondary-400">
            {snap.cash_position?.accounts?.length ? `${snap.cash_position.accounts.length} account(s)` : 'across cash & bank'}
          </p>
        </div>
      </div>
      <p className="mt-2 pt-2 border-t border-secondary-100 dark:border-secondary-800 text-[10px] text-secondary-400">
        Based on AccountX data{snap.generated_at ? ` · snapshot ${new Date(snap.generated_at).toLocaleString()}` : ''}
      </p>
    </div>
  );
}
