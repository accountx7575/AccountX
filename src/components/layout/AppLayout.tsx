import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { QuickActions } from '@/components/QuickActions';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-secondary-50 dark:bg-secondary-950">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
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
