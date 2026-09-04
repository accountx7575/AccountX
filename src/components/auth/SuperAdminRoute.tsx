import React, { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user, loading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (loading) return;

    if (!session) {
      navigate('/login', { state: { from: location }, replace: true });
      return;
    }

    const isSuperAdmin =
      Boolean(user?.app_metadata?.is_super_admin) ||
      Boolean(user?.user_metadata?.is_super_admin);

    if (!isSuperAdmin) {
      toast('Super admin access required', 'error');
      navigate('/dashboard', { state: { from: location }, replace: true });
    }
  }, [session, user, loading, navigate, location, toast]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-500 border-r-transparent"></div>
          <p className="mt-2 text-sm text-slate-400">Verifying Super Admin access...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);

  if (!isSuperAdmin) return null;

  return <>{children}</>;
}
