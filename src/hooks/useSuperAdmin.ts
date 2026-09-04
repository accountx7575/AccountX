import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export type PlatformMetrics = {
  total_businesses: number;
  total_users: number;
  total_invoices: number;
  total_revenue: number;
  total_payments: number;
  active_tenants: number;
};

export type BusinessSummary = {
  id: string;
  name: string;
  legal_name: string | null;
  owner_id: string;
  is_active: boolean;
  created_at: string;
};

export function useSuperAdmin() {
  const fetchMetrics = useCallback(async (): Promise<PlatformMetrics> => {
    const { data, error } = await supabase.rpc('get_platform_metrics');
    if (error) throw error;
    return data as PlatformMetrics;
  }, []);

  const fetchTenants = useCallback(async (): Promise<BusinessSummary[]> => {
    const { data, error } = await supabase.rpc('get_all_businesses_admin');
    if (error) throw error;
    return data as BusinessSummary[];
  }, []);

  const toggleTenantStatus = useCallback(
    async (businessId: string, status: boolean): Promise<void> => {
      const { error } = await supabase.rpc('update_user_role', {
        p_business_id: businessId,
        p_is_active: status,
      });
      if (error) throw error;
    },
    []
  );

  return { fetchMetrics, fetchTenants, toggleTenantStatus };
}

export type { PlatformMetrics, BusinessSummary };