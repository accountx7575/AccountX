import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  X, LayoutDashboard, FileText, ShoppingCart, Boxes, BarChart3, Settings,
} from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ArcRadioNav, type ArcNavItem } from './ArcRadioNav';
import { QuickActions } from '@/components/QuickActions';
import { useAuth } from '@/context/AuthContext';
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry';
import { usePlatformAnnouncement } from '@/hooks/usePlatformAnnouncement';
import { supabase } from '@/lib/supabase';

// Legacy keys (previous implementation) + Oscar spec keys. Both schemes are
// honored so either entry point triggers support mode for super-admins only.
const LEGACY_IMPERSONATING_KEY = 'super_admin_impersonating';
const OSCAR_IMPERSONATING_KEY = 'accountx_impersonating';
const ACTIVE_BUSINESS_KEY = 'accountx_active_business_id';
const OSCAR_TENANT_KEY = 'impersonated_tenant_id';
const LEGACY_TENANT_KEY = 'accountx_impersonating_business_id';

function clearImpersonationFlags() {
  localStorage.removeItem(LEGACY_IMPERSONATING_KEY);
  localStorage.removeItem(OSCAR_IMPERSONATING_KEY);
  localStorage.removeItem(OSCAR_TENANT_KEY);
  localStorage.removeItem(LEGACY_TENANT_KEY);
}

const announcementStyles: Record<string, string> = {
  info: 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900',
  warning: 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  critical: 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
  maintenance: 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
};

// Core destinations for the floating Arc radio dock (main app navigation).
const ARC_DOCK_ITEMS: ArcNavItem[] = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/app/sales-invoices', label: 'Sales', icon: FileText },
  { to: '/app/purchase-bills', label: 'Purchases', icon: ShoppingCart },
  { to: '/app/stock', label: 'Stock', icon: Boxes },
  { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeBusiness } = useAuth();
  const { logAdminEvent } = useAdminTelemetry();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);
  const wasImpersonating = useRef(false);
  const { announcement, dismiss: dismissAnnouncement } = usePlatformAnnouncement();

  const isSuperAdmin =
    Boolean(user?.app_metadata?.is_super_admin) ||
    Boolean(user?.user_metadata?.is_super_admin);

  useEffect(() => {
    const flag =
      localStorage.getItem(LEGACY_IMPERSONATING_KEY) === 'true' ||
      localStorage.getItem(OSCAR_IMPERSONATING_KEY) === 'true';
    // Regular users must NEVER see or spoof this banner: gate strictly on
    // super-admin. Scrub the flags if a non-admin somehow has them set.
    if (!flag || !isSuperAdmin) {
      if (flag && !isSuperAdmin) {
        clearImpersonationFlags();
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

    const storedId =
      localStorage.getItem(OSCAR_TENANT_KEY) ||
      localStorage.getItem(ACTIVE_BUSINESS_KEY) ||
      localStorage.getItem(LEGACY_TENANT_KEY);
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

  // Audit trail: record entering impersonation mode once per session entry.
  useEffect(() => {
    if (isImpersonating && isSuperAdmin && !wasImpersonating.current) {
      wasImpersonating.current = true;
      const tenantId =
        localStorage.getItem(OSCAR_TENANT_KEY) ||
        localStorage.getItem(ACTIVE_BUSINESS_KEY) ||
        localStorage.getItem(LEGACY_TENANT_KEY);
      void logAdminEvent('IMPERSONATION_START', tenantId, {
        business_name: impersonatedName,
      });
    }
    if (!isImpersonating) {
      wasImpersonating.current = false;
    }
  }, [isImpersonating, isSuperAdmin, impersonatedName, logAdminEvent]);

  const handleExitToControlCenter = () => {
    const tenantId =
      localStorage.getItem(OSCAR_TENANT_KEY) ||
      localStorage.getItem(ACTIVE_BUSINESS_KEY) ||
      localStorage.getItem(LEGACY_TENANT_KEY);
    // Zero residual contamination: clear every impersonation key before routing.
    clearImpersonationFlags();
    try {
      sessionStorage.removeItem('accountx_impersonation_notice_seen');
    } catch {
      /* ignore */
    }
    setIsImpersonating(false);
    setImpersonatedName(null);
    wasImpersonating.current = false;
    void logAdminEvent('IMPERSONATION_END', tenantId, {
      business_name: impersonatedName,
    });
    navigate('/super-admin');
  };

  const showBanner = isImpersonating && isSuperAdmin;
  const announcementStyle =
    announcementStyles[announcement?.severity ?? 'info'] ?? announcementStyles.info;

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
              ⚠️ SUPER ADMIN SUPPORT MODE: Viewing dashboard of{' '}
              {impersonatedName ?? 'Unknown Business'}. Actions taken here will
              affect tenant live data.
            </span>
            <span aria-hidden="true">—</span>
            <button
              type="button"
              onClick={handleExitToControlCenter}
              className="underline underline-offset-2 hover:text-amber-800 font-semibold"
            >
              Exit to Admin Control Center
            </button>
          </div>
        )}
        <Header
          onMobileMenu={() => setMobileOpen(true)}
          onQuickAction={() => setQuickOpen(true)}
        />
        {announcement && (
          <div
            role="status"
            className={`mx-4 sm:mx-6 lg:mx-8 mt-3 rounded-lg border px-4 py-2.5 flex items-start gap-3 text-sm ${announcementStyle}`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{announcement.title}</p>
              <p className="mt-0.5 break-words">{announcement.message}</p>
            </div>
            <button
              type="button"
              onClick={dismissAnnouncement}
              aria-label="Dismiss announcement"
              className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <main className="flex-1 pb-24" id="page-mount">
          {/* Centered content container (~1440px) with page transition mount point */}
          <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
            <div key={location.pathname} className="animate-fade-up motion-reduce:animate-none">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
      {/* Floating Arc radio dock: traveling light ring across core routes */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 pb-[env(safe-area-inset-bottom)]">
        <ArcRadioNav items={ARC_DOCK_ITEMS} ariaLabel="Quick sections" />
      </div>
      <QuickActions open={quickOpen} onClose={() => setQuickOpen(false)} />
    </div>
  );
}
