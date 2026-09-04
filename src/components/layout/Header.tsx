import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Menu, Search, Bell, Moon, Sun, ChevronDown, User, Settings,
  LogOut, Building2, Plus, HelpCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/Button';
import { UserProfileModal } from '@/components/layout/UserProfileModal';
import { AlertsDropdown, type StockAlert } from '@/components/layout/NotificationsDropdown';
import { HelpDropdown } from '@/components/layout/HelpDropdown';
import { cn, getInitials } from '@/lib/utils';
import { roleLabel } from '@/lib/rbac';
import { dropdownPop, dropdownTransition } from '@/lib/motion';

type HeaderProps = {
  onMobileMenu: () => void;
  onQuickAction: () => void;
  breadcrumbs?: ReactNode;
};

export function Header({ onMobileMenu, onQuickAction, breadcrumbs }: HeaderProps) {
  const { user, businesses, activeBusiness, activeRole, setActiveBusiness, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [bizDropdown, setBizDropdown] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const bizRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Alerts are a real-signal feed ONLY: live low-stock derivation from
  // actual product levels. Nothing here is seeded or invented.
  const { data: alertProducts } = useQuery({
    queryKey: ['products', activeBusiness?.id, 'type-product'],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('products')
        .select('id, name, current_stock, minimum_stock, unit')
        .eq('business_id', activeBusiness.id)
        .eq('type', 'product')
        .eq('is_active', true);
      return data as { id: string; name: string; current_stock: number; minimum_stock: number; unit: string }[];
    },
    enabled: !!activeBusiness,
  });
  const stockAlerts: StockAlert[] = (alertProducts || []).filter(
    (p) => p.minimum_stock > 0 && p.current_stock <= p.minimum_stock
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) setBizDropdown(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserDropdown(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setBizDropdown(false);
        setUserDropdown(false);
        setNotifOpen(false);
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    toast('Signed out successfully', 'info');
    navigate('/login');
  };

  return (
    <div className="sticky top-0 z-30 w-full">
      <header
        className={cn(
          'w-full px-6 py-3 flex items-center justify-between gap-6 border-b bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md',
          breadcrumbs ? 'border-transparent' : 'border-zinc-200/80 dark:border-zinc-800'
        )}
      >
      <button
        onClick={onMobileMenu}
        aria-label="Open navigation menu"
        className="lg:hidden text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 p-2.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Left Zone — Business Switcher pinned far left */}
      <div ref={bizRef} className="relative shrink-0">
        <button
          onClick={() => setBizDropdown(!bizDropdown)}
          title={activeBusiness?.name || 'Select Business'}
          aria-haspopup="true"
          aria-expanded={bizDropdown}
          className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        >
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 p-1.5 shrink-0">
            <Building2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-left hidden sm:block">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-tight max-w-40 truncate">
              {activeBusiness?.name || 'Select Business'}
            </p>
            <p className="text-[10px] text-zinc-400 leading-tight">
              {roleLabel(activeRole)}
              {activeBusiness ? ` · ${activeBusiness.gst_registered ? 'GST Registered' : 'Unregistered'}` : ''}
            </p>
          </div>
          <ChevronDown className={cn('h-4 w-4 text-zinc-400 transition-transform hidden sm:block', bizDropdown && 'rotate-180')} />
        </button>

        {bizDropdown && (
          <motion.div
            className="absolute top-full mt-1 left-0 w-72 card p-2 z-50 origin-top-left"
            {...(reduce ? {} : dropdownPop)}
            transition={dropdownTransition}
          >
            <div className="max-h-64 overflow-y-auto scrollbar-thin">
              {businesses.map((biz) => (
                <button
                  key={biz.id}
                  onClick={() => {
                    setActiveBusiness(biz);
                    setBizDropdown(false);
                    toast(`Switched to ${biz.name}`, 'info');
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors',
                    biz.id === activeBusiness?.id
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  )}
                >
                  <div className="rounded-md bg-zinc-100 dark:bg-zinc-700 p-1.5">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{biz.name}</p>
                    <p className="text-xs text-zinc-400 truncate">{biz.city}, {biz.state}</p>
                  </div>
                  {biz.id === activeBusiness?.id && (
                    <div className="h-2 w-2 rounded-full bg-indigo-500" />
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-zinc-200 dark:border-zinc-800 mt-1 pt-1">
              <button
                onClick={() => {
                  setBizDropdown(false);
                  navigate('/setup-business');
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm font-medium">Add New Business</span>
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Middle Zone — Expanded Search Box */}
      <div className="flex-1 max-w-2xl mx-auto hidden md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            ref={searchRef}
            type="text"
            aria-label="Search customers, invoices, products"
            placeholder="Search customers, invoices, products..."
            className="w-full h-10 pl-10 pr-16 rounded-xl bg-zinc-100/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 shadow-sm">
            Ctrl K
          </kbd>
        </div>
      </div>

      <div className="flex-1 md:hidden" />

      {/* Right Zone — pinned far right */}
      <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
        <Button onClick={onQuickAction} size="sm" className="hidden sm:flex">
          <Plus className="h-4 w-4" /> New
        </Button>
        <Button
          onClick={onQuickAction}
          size="sm"
          aria-label="Create new"
          title="Create new"
          className="sm:hidden !px-2.5"
        >
          <Plus className="h-4 w-4" />
        </Button>

        <button
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="p-2.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        >
          {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>

        <div ref={notifRef} className="relative">
          <button
            onClick={() => { setNotifOpen(!notifOpen); setHelpOpen(false); }}
            title="Alerts"
            aria-haspopup="true"
            aria-expanded={notifOpen}
            aria-label={`Alerts${stockAlerts.length > 0 ? ` (${stockAlerts.length})` : ''}`}
            className="p-2.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          >
            <Bell className="h-5 w-5" />
            {stockAlerts.length > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-900" />
            )}
          </button>
          {notifOpen && <AlertsDropdown alerts={stockAlerts} />}
        </div>

        <div ref={helpRef} className="relative hidden sm:block">
          <button
            onClick={() => { setHelpOpen(!helpOpen); setNotifOpen(false); }}
            title="Help"
            aria-haspopup="true"
            aria-expanded={helpOpen}
            aria-label="Help and support"
            className="p-2.5 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          >
            <HelpCircle className="h-5 w-5" />
          </button>
          {helpOpen && <HelpDropdown onClose={() => setHelpOpen(false)} />}
        </div>

        {/* User Menu */}
        <div ref={userRef} className="relative">
          <button
            onClick={() => setUserDropdown(!userDropdown)}
            aria-label="Account menu"
            aria-haspopup="true"
            aria-expanded={userDropdown}
            className="flex items-center gap-2 p-1 min-h-[40px] rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
          >
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center text-sm font-semibold shadow-sm ring-2 ring-white dark:ring-zinc-900">
              {getInitials(user?.user_metadata?.name || user?.email || 'U')}
            </div>
            <ChevronDown className={cn('h-4 w-4 text-zinc-400 hidden sm:block transition-transform', userDropdown && 'rotate-180')} />
          </button>

          {userDropdown && (
            <motion.div
              className="absolute top-full right-0 mt-1 w-56 card p-2 z-50 origin-top-right"
              {...(reduce ? {} : dropdownPop)}
              transition={dropdownTransition}
            >
              <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 mb-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {user?.user_metadata?.name || 'User'}
                </p>
                <p className="text-xs text-zinc-400 truncate">{user?.email}</p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-[10px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  {roleLabel(activeRole)}
                </span>
              </div>
              <button
                onClick={() => {
                  setUserDropdown(false);
                  setProfileOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <User className="h-4 w-4" /> My Profile
              </button>
              <button
                onClick={() => { setUserDropdown(false); navigate('/app/settings'); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Settings className="h-4 w-4" /> Business Settings
              </button>
              <button
                onClick={() => { setUserDropdown(false); navigate('/setup-business'); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Building2 className="h-4 w-4" /> Add Business
              </button>
              <div className="border-t border-zinc-200 dark:border-zinc-800 my-1" />
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </motion.div>
          )}
        </div>
      </div>

      </header>
      {breadcrumbs && (
        <nav
          aria-label="Breadcrumb"
          className="w-full px-6 py-2 border-b border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md text-xs text-secondary-500 dark:text-secondary-400 flex items-center gap-1.5 min-h-[36px]"
        >
          {breadcrumbs}
        </nav>
      )}
      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
