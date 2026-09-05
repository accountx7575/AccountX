import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Business, BusinessMember } from '@/types/db';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  businesses: Business[];
  activeBusiness: Business | null;
  activeRole: string | null;
  impersonatingBusinessId: string | null;
  setImpersonatingBusinessId: (id: string | null) => void;
  setActiveBusiness: (business: Business | null) => void;
  refreshBusinesses: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'accountx_active_business_id';
const IMPERSONATION_STORAGE_KEY = 'accountx_impersonating_business_id';
const SUPER_ADMIN_IMPERSONATING_KEY = 'super_admin_impersonating';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [impersonatingBusinessId, setImpersonatingBusinessIdState] = useState<string | null>(null);

  const [members, setMembers] = useState<BusinessMember[]>([]);

  const loadBusinesses = async (userId: string) => {
    // Check for impersonation first
    const storedImpersonationId = localStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (storedImpersonationId) {
      const { data: bizData } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', storedImpersonationId)
        .single();
      if (bizData) {
        const target = bizData as Business;
        setActiveBusinessState(target);
        setActiveRole('super-admin'); // impersonation mode has super-admin role
        return;
      }
      // Impersonation ID no longer exists, clear it
      localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      setImpersonatingBusinessId(null);
    }

    // Super-admin support mode: flag + active business id set from SuperAdminPage.
    // Only super-admins may use it; regular users get the flag cleared.
    if (localStorage.getItem(SUPER_ADMIN_IMPERSONATING_KEY) === 'true') {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      const isSuperAdmin =
        Boolean(authUser?.app_metadata?.is_super_admin) ||
        Boolean(authUser?.user_metadata?.is_super_admin);
      const storedActiveId = localStorage.getItem(STORAGE_KEY);
      if (!isSuperAdmin || !storedActiveId) {
        localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
      } else {
        const { data: impersonatedBiz } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', storedActiveId)
          .single();
        if (impersonatedBiz) {
          const target = impersonatedBiz as Business;
          setActiveBusinessState(target);
          setActiveRole('super-admin');
          setImpersonatingBusinessIdState(storedActiveId);
          return;
        }
        localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
      }
    }

    const { data: memberRows } = await supabase
      .from('business_members')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (!memberRows || memberRows.length === 0) {
      setMembers([]);
      setBusinesses([]);
      setActiveBusinessState(null);
      setActiveRole(null);
      return;
    }

    setMembers(memberRows as BusinessMember[]);

    const businessIds = memberRows.map((m) => m.business_id);
    const { data: bizData } = await supabase
      .from('businesses')
      .select('*')
      .in('id', businessIds)
      .order('created_at', { ascending: true });

    const bizList = (bizData || []) as Business[];
    setBusinesses(bizList);

    const storedId = localStorage.getItem(STORAGE_KEY);
    const storedBiz = storedId ? bizList.find((b) => b.id === storedId) : null;
    const target = storedBiz || bizList[0] || null;

    setActiveBusinessState(target);
    if (target) {
      localStorage.setItem(STORAGE_KEY, target.id);
      const member = memberRows.find((m) => m.business_id === target.id);
      setActiveRole(member?.role || 'viewer');
    } else {
      setActiveRole(null);
    }
  };

  const setActiveBusiness = (business: Business | null) => {
    setActiveBusinessState(business);
    if (business) {
      localStorage.setItem(STORAGE_KEY, business.id);
      const member = members.find((m) => m.business_id === business.id);
      setActiveRole(member?.role || 'viewer');
    } else {
      setActiveRole(null);
    }
  };

  const refreshBusinesses = async () => {
    if (user) await loadBusinesses(user.id);
  };

  const setImpersonatingBusinessId = (id: string | null) => {
    if (id) {
      localStorage.setItem(IMPERSONATION_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    }
    setImpersonatingBusinessIdState(id);
    refreshBusinesses();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
    setBusinesses([]);
    setActiveBusinessState(null);
    setActiveRole(null);
    setImpersonatingBusinessId(null);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        loadBusinesses(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (!newSession) {
        setBusinesses([]);
        setActiveBusinessState(null);
        setActiveRole(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
        localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      } else {
        (async () => {
          await loadBusinesses(newSession.user.id);
        })();
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        loading,
        businesses,
        activeBusiness,
        activeRole,
        impersonatingBusinessId,
        setImpersonatingBusinessId,
        setActiveBusiness,
        refreshBusinesses,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
