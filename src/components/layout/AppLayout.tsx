import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { QuickActions } from '@/components/QuickActions';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const SUPER_ADMIN_IMPERSONATING_KEY = 'super_admin_impersonating';
const ACTIVE_BUSINESS_KEY = 'accountx_active_business_id';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeBusiness } = useAuth();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);

  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);

  useEffect(() => {
    const flag = localStorage.getItem(SUPER_ADMIN_IMPERSONATING_KEY) === 'true';
    // Regular users must never see the banner: gate strictly on super-admin.
    if (!flag || !isSuperAdmin) {
      if (flag && !isSuperAdmin) {
        localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
      }
      setIsImpersonating(false);
      setImpersonatedName(null);
      return;
    }
    setIsImpersonating(true);

    const active = activeBusiness as unknown as Record<string, unknown> | null;
    const activeId = typeof active?.id === 'string' ? (active.id as string) : null;
    const activeName =
      (typeof active?.legal_name === 'string' && (active.legal_name as string)) ||
      (typeof active?.name === 'string' && (active.name as string)) ||
      null;
    if (activeId && activeName) {
      setImpersonatedName(activeName);
      return;
    }

    const storedId = localStorage.getItem(ACTIVE_BUSINESS_KEY);
    if (!storedId) {
      setImpersonatedName('Unknown Business');
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('businesses')
        .select('legal_name, name')
        .eq('id', storedId)
        .single();
      if (cancelled) return;
      const row = data as { legal_name?: string | null; name?: string | null } | null;
      setImpersonatedName(row?.legal_name || row?.name || 'Unknown Business');
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, activeBusiness]);

  const handleExitToControlCenter = () => {
    localStorage.removeItem(SUPER_ADMIN_IMPERSONATING_KEY);
    setIsImpersonating(false);
    setImpersonatedName(null);
    navigate('/super-admin');
  };

  const showBanner = isImpersonating && isSuperAdmin;

  return (
    <div className="flex min-h-screen bg-secondary-50 dark:bg-secondary-950">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {showBanner && (
          <div className="sticky top-0 z-50 w-full bg-amber-400 text-amber-950 px-4 sm:px-6 py-2 flex items-center justify-center gap-2 text-sm font-medium">
            <span>
              Viewing as {impersonatedName ?? 'Unknown Business'} (Super Admin Mode)
            </span>
            <span aria-hidden="true">—</span>
            <button
              type="button"
              onClick={handleExitToControlCenter}
              className="underline underline-offset-2 hover:text-amber-800 font-semibold"
            >
              Exit to Control Center
            </button>
          </div>
        )}
        <Header
          onMobileMenu={() => setMobileOpen(true)}
          onQuickAction={() => setQuickOpen(true)}
        />
        <main className="flex-1" id="page-mount">
          {/* Centered content container (~1440px) with page transition mount point */}
          <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
            <div key={location.pathname} className="animate-fade-up motion-reduce:animate-none">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
      <QuickActions open={quickOpen} onClose={() => setQuickOpen(false)} />
    </div>
  );
}
