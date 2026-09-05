import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AdminAuditRow = {
  id: string;
  actor_email: string;
  action: string;
  target_business_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AuditSeverity = 'critical' | 'warning' | 'info';

/** Derive a UI severity bucket from the audit action name. */
export function auditSeverity(action: string): AuditSeverity {
  const a = action.toUpperCase();
  if (
    a.includes('BLOCK') ||
    a.includes('CANCEL') ||
    a.includes('DELETE') ||
    a.includes('REVOKE') ||
    a.includes('FAIL')
  ) {
    return 'critical';
  }
  if (
    a.includes('QUOTA') ||
    a.includes('PLAN') ||
    a.includes('UPGRADE') ||
    a.includes('PAST_DUE') ||
    a.includes('TRIAL') ||
    a.includes('MAINTENANCE')
  ) {
    return 'warning';
  }
  return 'info';
}

function browserMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(extra ?? {}) };
  try {
    meta.userAgent =
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null;
    meta.language = typeof navigator !== 'undefined' ? navigator.language : null;
    meta.platform = typeof navigator !== 'undefined' ? (navigator as any).platform ?? null : null;
    meta.url = typeof window !== 'undefined' ? window.location.href.slice(0, 500) : null;
    meta.logged_at = new Date().toISOString();
  } catch {
    /* metadata is best-effort — never block the audit write */
  }
  return meta;
}

/**
 * Centralized Super Admin telemetry recorder.
 * Fire-and-forget: resolves void and never throws, so admin workflows are
 * never blocked by a telemetry failure.
 */
export function useAdminTelemetry() {
  const logAdminEvent = useCallback(
    async (
      action: string,
      targetBusinessId?: string | null,
      metadata?: Record<string, unknown>,
    ): Promise<void> => {
      try {
        let actorEmail = 'system';
        try {
          const { data } = await supabase.auth.getUser();
          actorEmail = data?.user?.email || 'system';
        } catch {
          /* fall through with system */
        }
        await supabase.from('admin_audit_logs').insert({
          actor_email: actorEmail,
          action,
          target_business_id: targetBusinessId ?? null,
          metadata: browserMetadata(metadata),
        });
      } catch {
        /* telemetry must never break the admin workflow */
      }
    },
    [],
  );

  return { logAdminEvent };
}

export type AuditTrailFilters = {
  page: number;
  pageSize: number;
  search: string;
  severity: 'all' | AuditSeverity;
};

/**
 * Live, paginated audit trail reader for the System Telemetry tab.
 * Search matches actor email / action; severity is derived client-side from
 * the action name so no schema change is required.
 */
export function useAuditTrail({ page, pageSize, search, severity }: AuditTrailFilters) {
  const [rows, setRows] = useState<AdminAuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Over-fetch one page when a severity filter is active, since severity
        // is derived client-side from the action name.
        const fetchSize = severity === 'all' ? pageSize : pageSize * 5;
        const from = severity === 'all' ? page * pageSize : 0;
        const to = from + fetchSize - 1;

        let query = supabase
          .from('admin_audit_logs')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);

        const q = search.trim();
        if (q) {
          const like = `%${q.replace(/[%_]/g, '')}%`;
          query = query.or(`actor_email.ilike.${like},action.ilike.${like}`);
        }

        const { data, error: queryError, count } = await query;
        if (queryError) throw queryError;
        if (!mounted) return;
        let list = (data ?? []) as AdminAuditRow[];
        if (severity !== 'all') {
          list = list.filter((r) => auditSeverity(r.action) === severity);
          setTotal(list.length);
          setRows(list.slice(page * pageSize, page * pageSize + pageSize));
        } else {
          setTotal(count ?? list.length);
          setRows(list);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load audit trail');
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [page, pageSize, search, severity]);

  return { rows, total, loading, error };
}
