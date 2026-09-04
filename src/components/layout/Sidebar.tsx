import { NavLink } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard, FileText, FileSpreadsheet, ShoppingCart, Package,
  Users, Truck, Wallet, Receipt, BookOpen, BarChart3, Settings,
  Boxes, ArrowLeftRight, ClipboardList, Landmark, ChevronLeft,
  CreditCard, Banknote, Calculator, FileMinus, FilePlus, PackageOpen,
  ShieldCheck, Sparkles, BadgePercent, FileCode2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { can, type Capability } from '@/lib/rbac';
import { backdropFade, FadeWhen } from '@/lib/motion';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  capability?: Capability;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: '',
    items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Intelligence',
    items: [{ to: '/app/ai', label: 'AccountX AI', icon: Sparkles }],
  },
  {
    title: 'Sales',
    items: [
      { to: '/app/sales-invoices', label: 'Sales Invoices', icon: FileText },
      { to: '/app/quotations', label: 'Quotations', icon: ClipboardList },
      { to: '/app/sales-orders', label: 'Sales Orders', icon: FileSpreadsheet },
      { to: '/app/credit-notes', label: 'Credit Notes', icon: FileMinus },
      { to: '/app/customers', label: 'Customers', icon: Users },
      { to: '/app/payments-received', label: 'Payment Received', icon: Banknote },
    ],
  },
  {
    title: 'Purchase',
    items: [
      { to: '/app/purchase-bills', label: 'Purchase Bills', icon: ShoppingCart },
      { to: '/app/debit-notes', label: 'Debit Notes', icon: FilePlus },
      { to: '/app/purchase-orders', label: 'Purchase Orders', icon: PackageOpen },
      { to: '/app/suppliers', label: 'Suppliers', icon: Truck },
      { to: '/app/payments-made', label: 'Payment Made', icon: CreditCard },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { to: '/app/products', label: 'Products', icon: Package },
      { to: '/app/stock', label: 'Stock Overview', icon: Boxes },
      { to: '/app/stock-adjustment', label: 'Stock Adjustment', icon: ArrowLeftRight },
    ],
  },
  {
    title: 'Accounting',
    items: [
      { to: '/app/ledger', label: 'Ledger', icon: BookOpen },
      { to: '/app/chart-of-accounts', label: 'Chart of Accounts', icon: Landmark },
      { to: '/app/journal-entries', label: 'Journal Entries', icon: ClipboardList },
      { to: '/app/trial-balance', label: 'Trial Balance', icon: BarChart3 },
    ],
  },
  {
    title: 'Expenses',
    items: [{ to: '/app/expenses', label: 'Expenses', icon: Receipt }],
  },
  {
    title: 'Reports',
    items: [{ to: '/app/reports', label: 'Reports', icon: BarChart3 }],
  },
  {
    title: 'Compliance',
    items: [
      { to: '/app/gst', label: 'GST Compliance', icon: BadgePercent },
      { to: '/app/tally', label: 'Tally Export', icon: FileCode2 },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/app/admin', label: 'Admin', icon: ShieldCheck, capability: 'members.manage' },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
};

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  const { activeBusiness, activeRole } = useAuth();
  const reduce = useReducedMotion();

  return (
    <>
      {mobileOpen && (
        <motion.div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onMobileClose}
          {...(reduce ? {} : backdropFade)}
        />
      )}

      <aside
        className={cn(
          'fixed lg:sticky top-0 left-0 z-40 h-screen bg-white dark:bg-secondary-900 border-r border-secondary-200/70 dark:border-secondary-800/80 flex flex-col transition-all duration-200',
          collapsed ? 'w-16' : 'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center gap-2.5 px-4 h-16 border-b border-secondary-200/70 dark:border-secondary-800/80 shrink-0">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-md shadow-indigo-500/25 p-1.5 shrink-0">
            <Calculator className="h-5 w-5 text-white" />
          </div>
          <FadeWhen show={!collapsed}>
            <span className="text-lg font-bold text-secondary-900 dark:text-white tracking-tight">
              Account<span className="text-primary-600 dark:text-primary-400">X</span>
            </span>
          </FadeWhen>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
          {navSections.map((section, idx) => {
            const visibleItems = section.items.filter(
              (item) => !item.capability || can(activeRole, item.capability)
            );
            if (visibleItems.length === 0) return null;
            return (
            <div
              key={idx}
              className={cn(
                'mb-1.5 pb-1.5 border-b border-secondary-100/80 dark:border-secondary-800/50 last:border-b-0',
                collapsed && 'pb-2'
              )}
            >
              <FadeWhen show={!collapsed && !!section.title} className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-secondary-400/90 dark:text-secondary-500">
                {section.title}
              </FadeWhen>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/app'}
                  onClick={onMobileClose}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 px-3 py-[7px] text-sm transition-all duration-150 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
                      collapsed && 'justify-center px-2',
                      isActive
                        ? 'bg-primary-50 dark:bg-primary-900/25 text-primary-700 dark:text-primary-300 font-semibold shadow-[inset_0_0_0_1px_rgba(99,102,241,0.14)]'
                        : 'text-secondary-600 dark:text-secondary-400 hover:bg-secondary-100/70 dark:hover:bg-secondary-800/70 hover:text-secondary-900 dark:hover:text-secondary-200 font-medium'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-gradient-to-b from-indigo-500 to-violet-500" aria-hidden="true" />
                      )}
                      <item.icon className={cn('h-4 w-4 shrink-0 transition-transform duration-150', !isActive && 'group-hover:scale-110')} />
                      <FadeWhen show={!collapsed}>{item.label}</FadeWhen>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
            );
          })}
        </nav>

        <div className="border-t border-secondary-200/70 dark:border-secondary-800/80 shrink-0 p-2">
          <FadeWhen show={!collapsed && !!activeBusiness}>
            <div className="px-2 py-1.5 mb-1">
              <p className="text-[10px] uppercase tracking-wider text-secondary-400">Active Business</p>
              <p className="text-xs font-medium text-secondary-700 dark:text-secondary-300 truncate">{activeBusiness?.name}</p>
            </div>
          </FadeWhen>
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800 rounded-lg transition-colors"
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform duration-200', collapsed && 'rotate-180')} />
            <FadeWhen show={!collapsed}>Collapse</FadeWhen>
          </button>
        </div>
      </aside>
    </>
  );
}
