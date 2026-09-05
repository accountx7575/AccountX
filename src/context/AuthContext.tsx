import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Business, BusinessMember } from '@/types/db';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  businessesReady: boolean;
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
  const [businessesReady, setBusinessesReady] = useState(false);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [impersonatingBusinessId, setImpersonatingBusinessIdState] = useState<string | null>(null);

  const [members, setMembers] = useState<BusinessMember[]>([]);
  const currentUserIdRef = useRef<string | null>(null);

  const loadBusinesses = async (userId: string, isInitial = false) => {
    // Sirf first time load par screen block karein, background me kabhi unmount na ho
    if (isInitial) {
      setBusinessesReady(false);
    }
    try {
      await loadBusinessesInner(userId);
    } finally {
      setBusinessesReady(true);
    }
  };

  const loadBusinessesInner = async (userId: string) => {
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
        setActiveRole('super-admin');
        return;
      }
      localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
      setImpersonatingBusinessId(null);
    }

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
    if (currentUserIdRef.current) {
      await loadBusinesses(currentUserIdRef.current, false);
    }
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
    localStorage.removeItem('accountx_impersonating');
    localStorage.removeItem('impersonated_tenant_id');
    currentUserIdRef.current = null;
    setBusinesses([]);
    setBusinessesReady(false);
    setActiveBusinessState(null);
    setActiveRole(null);
    setImpersonatingBusinessId(null);
  };

  useEffect(() => {
    // Initial Session Mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      const u = data.session?.user ?? null;
      setUser(u);
      currentUserIdRef.current = u?.id ?? null;

      if (u) {
        loadBusinesses(u.id, true).finally(() => setLoading(false));
      } else {
        setLoading(false);
        setBusinessesReady(true);
      }
    });

    // Auth State Listener
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUserId = newSession?.user?.id ?? null;
      const previousUserId = currentUserIdRef.current;

      setSession(newSession);
      setUser(newSession?.user ?? null);
      currentUserIdRef.current = newUserId;

      if (!newSession) {
        setBusinesses([]);
        setBusinessesReady(false);
        setActiveBusinessState(null);
        setActiveRole(null);
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
        localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
        localStorage.removeItem('accountx_impersonating');
        localStorage.removeItem('impersonated_tenant_id');
      } else if (newUserId && newUserId !== previousUserId) {
        // Sirf user ID actually badalne par hi businesses re-fetch karein
        loadBusinesses(newUserId, false);
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
        businessesReady,
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