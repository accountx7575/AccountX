import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  LayoutDashboard, Users, FileSearch, Building2, LifeBuoy, Megaphone, LogOut, ShieldCheck,
} from 'lucide-react';

const NAV = [
  { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'Users & Tenants', icon: Users, end: false },
  { to: '/super-admin/documents', label: 'Documents', icon: FileSearch, end: false },
  { to: '/super-admin/console', label: 'Control Center', icon: Building2, end: false },
  { to: '/super-admin/plans', label: 'Plans', icon: Building2, end: false },
  { to: '/super-admin/support', label: 'Support', icon: LifeBuoy, end: false },
  { to: '/super-admin/broadcast', label: 'Broadcast', icon: Megaphone, end: false },
];

export function SuperAdminShell() {
  const { user } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-secondary-50 dark:bg-secondary-950 flex">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-secondary-200 dark:border-secondary-800 bg-white dark:bg-secondary-900">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-secondary-200 dark:border-secondary-800">
          <div className="rounded-lg bg-primary-600 p-2">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-secondary-900 dark:text-white">Super Admin</p>
            <p className="text-[11px] text-secondary-400 truncate max-w-[130px]">{user?.email || '—'}</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300'
                    : 'text-secondary-600 dark:text-secondary-300 hover:bg-secondary-100 dark:hover:bg-secondary-800'
                }`
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-secondary-200 dark:border-secondary-800">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-10 overflow-x-auto">
        <Outlet />
      </main>
    </div>
  );
}
