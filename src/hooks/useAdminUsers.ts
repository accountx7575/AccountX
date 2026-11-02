import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AdminRole = 'owner' | 'admin' | 'accountant' | 'viewer';

/** Row shape of v_member_directory (migration 031) — verbatim. */
export interface DirectoryMember {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
}

type UseAdminUsersApi = {
  inviteMember: (email: string, role: AdminRole) => Promise<DirectoryMember>;
  changeMemberRole: (memberId: string, newRole: AdminRole) => Promise<void>;
  revokeMember: (memberId: string) => Promise<void>;
  transferOwnership: (memberId: string) => Promise<void>;
};

/**
 * Admin control-panel data layer over Oscar's migration-034 RPCs.
 * No optimistic updates — plain invalidate-on-success via refresh().
 */
export function useAdminUsers(businessId?: string): { members: DirectoryMember[]; loading: boolean; error: string | null; refresh: () => Promise<void> } & UseAdminUsersApi {
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setMembers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('v_member_directory')
        .select('membership_id, user_id, email, full_name, role, is_active, invited_at, joined_at')
        .eq('business_id', businessId)
        .order('joined_at', { ascending: true, nullsFirst: false });
      if (err) throw err;
      setMembers((data ?? []) as DirectoryMember[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const inviteMember = useCallback(
    async (email: string, role: AdminRole): Promise<DirectoryMember> => {
      const { data, error: err } = await supabase.rpc('admin_invite_member', {
        p_business_id: businessId,
        p_email: email,
        p_role: role,
      });
      if (err) throw err;
      await refresh();
      return data as DirectoryMember;
    },
    [businessId, refresh]
  );

  const changeMemberRole = useCallback(
    async (memberId: string, newRole: AdminRole) => {
      const { error: err } = await supabase.rpc('admin_change_member_role', {
        p_member_id: memberId,
        p_new_role: newRole,
      });
      if (err) throw err;
      await refresh();
    },
    [refresh]
  );

  const revokeMember = useCallback(
    async (memberId: string) => {
      const { error: err } = await supabase.rpc('admin_revoke_member', { p_member_id: memberId });
      if (err) throw err;
      await refresh();
    },
    [refresh]
  );

  const transferOwnership = useCallback(
    async (memberId: string) => {
      const { error: err } = await supabase.rpc('admin_transfer_ownership', { p_member_id: memberId });
      if (err) throw err;
      await refresh();
    },
    [refresh]
  );

  return { members, loading, error, refresh, inviteMember, changeMemberRole, revokeMember, transferOwnership };
}
