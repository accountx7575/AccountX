import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/** audit_log row (Oscar's migration-034 contract) — verbatim. */
export interface AuditLog {
  id: number | string;
  business_id: string;
  actor: string | null;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  meta: Record<string, unknown> | null;
  ip: string | null;
  device: string | null;
  created_at: string;
}

export type AuditLogFilters = {
  businessId?: string;
  page?: number;
  pageSize?: number;
  actionQuery?: string;
  userQuery?: string;
};

type UseAuditLogsReturn = {
  rows: AuditLog[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/** Paged audit trail fetch filtered by business + optional action/user search. */
export function useAuditLogs(filters: AuditLogFilters): UseAuditLogsReturn {
  const { businessId, page = 1, pageSize = 25, actionQuery, userQuery } = filters;
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from('audit_log')
        .select('*', { count: 'exact' })
        .eq('business_id', businessId);

      const action = actionQuery?.trim();
      if (action) q = q.ilike('action', `%${action}%`);

      const userQ = userQuery?.trim();
      if (userQ) q = q.ilike('actor_email', `%${userQ}%`);

      const from = (page - 1) * pageSize;
      const { data, error: err, count } = await q
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (err) throw err;
      setRows((data ?? []) as AuditLog[]);
      setTotal(count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [businessId, page, pageSize, actionQuery, userQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, total, loading, error, refresh };
}
