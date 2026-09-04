import React, { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!session) {
      navigate('/login', { state: { from: location }, replace: true });
      return;
    }

    if (!user) return;

    // Check directly against Supabase native app_metadata
    const isSuperAdmin =
      Boolean(user.app_metadata?.is_super_admin) ||
      Boolean(user.user_metadata?.is_super_admin);

    if (!isSuperAdmin) {
      toast('Super admin access required', 'error');
      navigate('/dashboard', { state: { from: location }, replace: true });
    }
  }, [session, user, navigate, location, toast]);

  if (!session) {
    return null;
  }

  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);

  if (!isSuperAdmin) {
    return null;
  }

  return <>{children}</>;
}
