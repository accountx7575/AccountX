import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface AdminTenant {
  id: string;
  legal_name: string | null;
  trade_name: string | null;
  gstin: string | null;
  created_at: string;
  is_active: boolean;
  owner_id: string;
  owner_email?: string;
}

export interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  blockedTenants: number;
  totalInvoices: number;
}

export function useSuperAdmin() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTenants = useCallback(async (): Promise<AdminTenant[]> => {
    setLoading(true);
    setError(null);
    try {
      // 1. Try RPC first
      const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_businesses_admin');
      if (!rpcErr && rpcData) {
        return rpcData as AdminTenant[];
      }

      // 2. Direct Fallback if RPC 400s
      const { data: fallbackData, error: fbErr } = await supabase
        .from('businesses')
        .select('*')
        .order('created_at', { ascending: false });

      if (fbErr) throw fbErr;
      return (fallbackData || []).map((b: any) => ({
        id: b.id,
        legal_name: b.legal_name || b.name || 'Unnamed Business',
        trade_name: b.trade_name || b.legal_name || '—',
        gstin: b.gstin || '—',
        created_at: b.created_at,
        is_active: b.is_active ?? true,
        owner_id: b.owner_id,
        owner_email: b.email || 'Registered Tenant'
      }));
    } catch (err: any) {
      console.warn('Admin fetch fallback engaged:', err.message);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMetrics = useCallback(async (): Promise<PlatformMetrics> => {
    try {
      const { data: businesses } = await supabase.from('businesses').select('id, is_active');
      const total = businesses?.length || 0;
      const active = businesses?.filter(b => b.is_active !== false).length || 0;
      const blocked = total - active;

      return {
        totalTenants: total,
        activeTenants: active,
        blockedTenants: blocked,
        totalInvoices: 0
      };
    } catch {
      return { totalTenants: 0, activeTenants: 0, blockedTenants: 0, totalInvoices: 0 };
    }
  }, []);

  const toggleTenantStatus = useCallback(async (businessId: string, currentStatus: boolean) => {
    try {
      const nextStatus = !currentStatus;
      const { error: rpcErr } = await supabase.rpc('toggle_business_status_admin', {
        p_business_id: businessId,
        p_is_active: nextStatus
      });

      if (rpcErr) {
        // Fallback direct update
        await supabase.from('businesses').update({ is_active: nextStatus }).eq('id', businessId);
      }
      return true;
    } catch (err) {
      console.error('Toggle status error:', err);
      return false;
    }
  }, []);

  return { loading, error, fetchTenants, fetchMetrics, toggleTenantStatus };
}
