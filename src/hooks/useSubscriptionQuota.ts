import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type SubscriptionQuota = {
  tier: string;
  limit: number;
  used: number;
  exceeded: boolean;
  loading: boolean;
};

function monthStartIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Free-tier invoice quota sentinel for the active business.
 * - Reads subscription_tier / max_invoices_per_month from public.businesses
 *   (missing columns on older schemas fall back to permissive defaults).
 * - Counts current-month rows in public.sales_invoices.
 * - exceeded === true only for the free tier at/over its monthly limit.
 */
export function useSubscriptionQuota(businessId: string | undefined): SubscriptionQuota {
  const [state, setState] = useState<Omit<SubscriptionQuota, 'loading'>>({
    tier: 'free',
    limit: 50,
    used: 0,
    exceeded: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!businessId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data: biz } = await supabase
          .from('businesses')
          .select('subscription_tier, max_invoices_per_month')
          .eq('id', businessId)
          .maybeSingle();
        const row = (biz ?? {}) as {
          subscription_tier?: string | null;
          max_invoices_per_month?: number | null;
        };
        const tier = String(row.subscription_tier ?? 'free').toLowerCase();
        const limit =
          typeof row.max_invoices_per_month === 'number'
            ? row.max_invoices_per_month
            : 50;

        let used = 0;
        if (tier === 'free') {
          const { count } = await supabase
            .from('sales_invoices')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', businessId)
            .gte('invoice_date', monthStartIso().slice(0, 10));
          used = count ?? 0;
        }

        if (mounted) {
          setState({
            tier,
            limit,
            used,
            exceeded: tier === 'free' && used >= limit,
          });
        }
      } catch {
        if (mounted) {
          setState((s) => ({ ...s, exceeded: false }));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [businessId]);

  return { ...state, loading };
}
