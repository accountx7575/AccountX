import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

type ProtectedRouteProps = { children: ReactNode };

/**
 * The auth gate. The /login route path is load-bearing for EVERY guard — the
 * anchor test pins this redirect target (PBS-76 N1).
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { session, loading, businessesReady, businesses, user, activeBusiness } = useAuth();
  const location = useLocation();

  const hasExistingAuth = Boolean(session && (activeBusiness || businesses.length > 0));

  if ((loading || (session && !businessesReady)) && !hasExistingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-secondary-50 dark:bg-secondary-950">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-primary-600 animate-bounce" />
          <p className="text-secondary-400 text-sm">Loading AccountX...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);
  const isImpersonating =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('super_admin_impersonating') === 'true';
  const supportMode = isSuperAdmin && isImpersonating;

  const ownerEmail = 'acc.x7575@gmail.com';
  if (user?.email === ownerEmail && !supportMode) {
    return <Navigate to="/super-admin" state={{ from: location }} replace />;
  }

  // /setup-business stays reachable with existing businesses: it is the
  // "+ Add New Business" flow (Header switcher + user menu). The
  // businesses.length === 0 gate below keeps first-login onboarding intact.
  if (businesses.length === 0 && !supportMode && location.pathname !== '/setup-business' && !location.pathname.startsWith('/super-admin')) {
    return <Navigate to="/setup-business" replace />;
  }

  return <>{children}</>;
}
