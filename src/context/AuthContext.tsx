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
  setActiveBusiness: (business: Business | null) => void;
  refreshBusinesses: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'accountx_active_business_id';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeBusiness, setActiveBusinessState] = useState<Business | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);

  const [members, setMembers] = useState<BusinessMember[]>([]);

  const loadBusinesses = async (userId: string) => {
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

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    setBusinesses([]);
    setActiveBusinessState(null);
    setActiveRole(null);
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
