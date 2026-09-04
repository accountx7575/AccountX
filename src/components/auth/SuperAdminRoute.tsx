import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

export function SuperAdminRoute({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user, activeRole } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!session) {
      navigate('/login', { state: { from: location }, replace: true });
      return;
    }

    // Check if user has super_admin profile flag
    ;(async () => {
      if (!user) return;
      try {
        const { data: profile, error } = await supabase
          .from('business_members')
          .select('is_super_admin')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        if (!profile?.is_super_admin) {
          toast('Super admin access required', 'error');
          navigate('/dashboard', { state: { from: location }, replace: true });
        }
      } catch (err) {
        toast('Failed to verify super admin status', 'error');
        navigate('/dashboard', { state: { from: location }, replace: true });
      }
    })();
  }, [session, user, navigate, location, toast]);

  if (!session) {
    return null; // Will redirect in effect
  }

  // Initial check - if we already know the user is not super admin, render null
  // Otherwise render children while the async check completes
  return <>{children}</>;
}