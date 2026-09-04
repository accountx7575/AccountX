import {
  Wallet, CreditCard, Banknote,
  Boxes, AlertTriangle, Receipt, ShoppingCart,
  FileText, Package, Users, Truck, Percent,
  Settings, PackagePlus, ArrowRight, Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { type ReactNode } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { useDashboardData } from '@/hooks/dashboard';
import { DashboardAssistant } from '@/components/ai/DashboardAssistant';
import { formatCurrency, formatDate } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

function compactCurrency(v: number): string {
  return `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`;
}

function shortDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>;
};

/** Dark/light-aware Recharts tooltip (class-driven so html.dark flips it automatically). */
function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-secondary-200/80 dark:border-secondary-700 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md px-3 py-2 text-xs shadow-lg">
      <p className="font-medium text-secondary-500 dark:text-secondary-400 mb-1">{typeof label === 'string' ? shortDate(label) : label}</p>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-secondary-600 dark:text-secondary-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <span className="figure text-secondary-900 dark:text-zinc-100">{formatCurrency(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-secondary-500 dark:text-secondary-400">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

function PanelHeader({ title, caption, children }: { title: string; caption?: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 leading-tight">{title}</h3>
        {caption && <p className="text-[11px] text-secondary-400 mt-0.5">{caption}</p>}
      </div>
      {children && <div className="flex items-center gap-3 shrink-0 pt-0.5">{children}</div>}
    </div>
  );
}

const QUICK_START_ACTIONS = [
  { label: 'Create Customer', hint: 'Add who you sell to', route: '/app/customers/new', icon: Users, accent: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30' },
  { label: 'Add Supplier', hint: 'Add who you buy from', route: '/app/suppliers/new', icon: Truck, accent: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30' },
  { label: 'Add Product', hint: 'Build your catalogue', route: '/app/products/new', icon: PackagePlus, accent: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30' },
  { label: 'Create Invoice', hint: 'Bill your first sale', route: '/app/sales-invoices/new', icon: FileText, accent: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' },
  { label: 'Record Purchase', hint: 'Log a supplier bill', route: '/app/purchase-bills/new', icon: ShoppingCart, accent: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30' },
  { label: 'Record Payment', hint: 'Money in or out', route: '/app/payments-received/new', icon: Banknote, accent: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30' },
  { label: 'Configure GST', hint: 'Tax profile & returns', route: '/app/gst', icon: Percent, accent: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30' },
  { label: 'Business Settings', hint: 'Invoice prefix, FY & more', route: '/app/settings', icon: Settings, accent: 'text-secondary-600 dark:text-zinc-300 bg-secondary-100 dark:bg-zinc-800' },
];

export function DashboardPage() {
  const { user, activeBusiness } = useAuth();
  const navigate = useNavigate();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  const { data: dash, isLoading, isError, refetchAll } = useDashboardData(activeBusiness?.id);

  // Supporting feeds (recents + low stock) — deliberately NOT the retired ['dashboard-stats'] key
  const recentInvoicesQ = useQuery({
    queryKey: ['recent-sales-invoices', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('sales_invoices')
        .select('id, invoice_number, customer_id, grand_total, status, invoice_date, created_at')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!activeBusiness,
  });
  const recentInvoices = recentInvoicesQ.data;

  const recentBillsQ = useQuery({
    queryKey: ['recent-purchase-bills', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('purchase_bills')
        .select('id, bill_number, supplier_id, grand_total, status, bill_date, created_at')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!activeBusiness,
  });
  const recentBills = recentBillsQ.data;

  const recentPaymentsQ = useQuery({
    queryKey: ['recent-payments', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return [];
      const { data } = await supabase
        .from('payments')
        .select('id, payment_number, amount, type, date, created_at')
        .eq('business_id', activeBusiness.id)
        .order('created_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!activeBusiness,
  });
  const recentPayments = recentPaymentsQ.data;

  const lowStockFeedQ = useQuery({
    queryKey: ['low-stock-alerts', activeBusiness?.id],
    queryFn: async () => {
      if (!activeBusiness) return { total: 0, low: [] as { id: string; name: string; current_stock: number; minimum_stock: number }[] };
      const { data } = await supabase
        .from('products')
        .select('id, name, current_stock, minimum_stock')
        .eq('business_id', activeBusiness.id);
      const products = (data || []) as { id: string; name: string; current_stock: number; minimum_stock: number }[];
      return {
        total: products.length,
        low: products.filter((p) => p.minimum_stock > 0 && p.current_stock <= p.minimum_stock),
      };
    },
    enabled: !!activeBusiness,
  });
  const lowStockFeed = lowStockFeedQ.data;

  const invoiceCustomerIds = new Set<string>();
  (recentInvoices || []).forEach((i: any) => i.customer_id && invoiceCustomerIds.add(i.customer_id));
  const billSupplierIds = new Set<string>();
  (recentBills || []).forEach((b: any) => b.supplier_id && billSupplierIds.add(b.supplier_id));

  const { data: customerNames } = useQuery({
    queryKey: ['customer-names', Array.from(invoiceCustomerIds)],
    queryFn: async () => {
      const ids = Array.from(invoiceCustomerIds);
      if (ids.length === 0) return {};
      const { data } = await supabase.from('customers').select('id, name').in('id', ids);
      return Object.fromEntries((data || []).map((c) => [c.id, c.name]));
    },
    enabled: invoiceCustomerIds.size > 0,
  });

  const { data: supplierNames } = useQuery({
    queryKey: ['supplier-names', Array.from(billSupplierIds)],
    queryFn: async () => {
      const ids = Array.from(billSupplierIds);
      if (ids.length === 0) return {};
      const { data } = await supabase.from('suppliers').select('id, name').in('id', ids);
      return Object.fromEntries((data || []).map((s) => [s.id, s.name]));
    },
    enabled: billSupplierIds.size > 0,
  });

  const sym = activeBusiness?.currency_symbol || '₹';

  const isEmptyWorkspace = !activeBusiness || !(
    (recentInvoices || []).length ||
    (recentBills || []).length ||
    (recentPayments || []).length ||
    (lowStockFeed?.low || []).length
  );

  const spSeries = dash?.salesPurchasesSeries ?? [];
  const cashflowSeries = dash?.cashflowSeries ?? [];
  const todayPoint = spSeries.length > 0 ? spSeries[spSeries.length - 1] : null;

  // Presentation-only slice of an existing feed: open docs among the 5 most-recent invoices.
  const outstandingInvoices = (recentInvoices || []).filter(
    (inv: any) => inv.status === 'issued' || inv.status === 'partially_paid'
  );

  const receivableDelta = dash?.receivables?.deltaPct ?? null;
  const payableDelta = dash?.payables?.deltaPct ?? null;

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.user_metadata?.name?.split(' ')[0] || 'User'}`}
        subtitle={activeBusiness ? `${activeBusiness.name}` : ''}
        meta={
          activeBusiness ? (
            <>
              <span className="badge bg-secondary-100 text-secondary-600 dark:bg-zinc-800 dark:text-zinc-300 border-transparent">
                FY {activeBusiness.financial_year}
              </span>
              <span className="badge bg-transparent text-secondary-500 dark:text-secondary-400 border-secondary-200 dark:border-zinc-700 figure">
                {formatDate(new Date().toISOString().slice(0, 10))}
              </span>
            </>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/app/purchase-bills/new')}
              className="h-10 px-5 text-sm font-medium rounded-xl bg-orange-500 hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-500 text-white shadow-sm hover:shadow transition-all flex items-center justify-center focus:ring-2 focus:ring-orange-500/30 focus:outline-none"
            >
              New Purchase
            </button>
            <button
              onClick={() => navigate('/app/sales-invoices/new')}
              className="h-10 px-5 text-sm font-medium rounded-xl bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white shadow-sm hover:shadow transition-all flex items-center justify-center focus:ring-2 focus:ring-indigo-500/30 focus:outline-none"
            >
              New Invoice
            </button>
          </div>
        }
      />

      {isError ? (
        <ErrorState title="Unable to load dashboard metrics. Please check your connection and try again." onRetry={() => refetchAll()} />
      ) : isEmptyWorkspace ? (
        <section className="card p-6 sm:p-10 animate-fade-up" aria-labelledby="empty-workspace-heading">
          <div className="text-center max-w-xl mx-auto mb-8">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary-50 dark:bg-primary-900/30 mb-4">
              <Sparkles className="h-6 w-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            </div>
            <h2 id="empty-workspace-heading" className="text-lg sm:text-xl font-bold tracking-tight text-secondary-900 dark:text-secondary-100 mb-1.5">
              {activeBusiness ? `${activeBusiness.name} is ready` : 'Your workspace is ready'}
            </h2>
            <p className="text-sm text-secondary-500 dark:text-secondary-400 leading-relaxed">
              Nothing has been recorded yet. Start with any step below — your dashboard comes alive as soon as the first entry lands.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 max-w-4xl mx-auto">
            {QUICK_START_ACTIONS.map(({ label, hint, route, icon: Icon, accent }) => (
              <button
                key={route}
                type="button"
                onClick={() => navigate(route)}
                className="group flex items-start gap-3 p-4 rounded-xl border border-secondary-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 hover:border-primary-500/40 hover:shadow-card-hover transition-all text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 min-h-[44px]"
              >
                <span className={`shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-lg ${accent}`} aria-hidden="true">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-secondary-900 dark:text-secondary-100 truncate">{label}</span>
                  <span className="block text-xs text-secondary-400 mt-0.5">{hint}</span>
                </span>
                <ArrowRight className="h-4 w-4 mt-1 shrink-0 text-secondary-300 group-hover:text-primary-500 transition-colors" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <DashboardAssistant />

          {/* Today metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3.5 mb-6 animate-fade-up items-stretch">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="card p-5 flex flex-col gap-3">
                  <div className="h-7 w-7 rounded-lg bg-secondary-100 dark:bg-secondary-800 ml-auto" />
                  <div className="h-6 w-20 rounded bg-secondary-100 dark:bg-secondary-800" />
                </div>
              ))
            ) : (
              <>
                <button type="button" onClick={() => navigate('/app/sales-invoices')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard label="Today's Sales" value={formatCurrency(todayPoint?.sales ?? 0, sym)} icon={FileText} className="h-full" />
                </button>
                <button type="button" onClick={() => navigate('/app/purchase-bills')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard label="Today's Purchases" value={formatCurrency(todayPoint?.purchases ?? 0, sym)} icon={ShoppingCart} className="h-full" />
                </button>
                <button type="button" onClick={() => navigate('/app/sales-invoices')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard
                    label="Receivables"
                    value={formatCurrency(dash?.receivables?.total ?? 0, sym)}
                    icon={Wallet}
                    tone="inflow"
                    delta={receivableDelta !== null ? { value: `${Math.abs(receivableDelta)}%`, direction: receivableDelta >= 0 ? 'up' : 'down', caption: 'vs prior 30d new bookings' } : undefined}
                    className="h-full"
                  />
                </button>
                <button type="button" onClick={() => navigate('/app/purchase-bills')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard
                    label="Payables"
                    value={formatCurrency(dash?.payables?.total ?? 0, sym)}
                    icon={CreditCard}
                    tone="outflow"
                    delta={payableDelta !== null ? { value: `${Math.abs(payableDelta)}%`, direction: payableDelta >= 0 ? 'up' : 'down', caption: 'vs prior 30d new bills' } : undefined}
                    className="h-full"
                  />
                </button>
                <button type="button" onClick={() => navigate('/app/ledger')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard label="Liquid Cash" value={formatCurrency(dash?.liquidCash ?? 0, sym)} icon={Banknote} tone="cash" className="h-full" />
                </button>
                <button type="button" onClick={() => navigate('/app/stock')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard label="Stock Value" value={formatCurrency(dash?.stockValue ?? 0, sym)} icon={Boxes} className="h-full" />
                </button>
                <button type="button" onClick={() => navigate('/app/products')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard label="Total Products" value={String(lowStockFeed?.total ?? 0)} icon={Package} className="h-full" />
                </button>
                <button type="button" onClick={() => navigate('/app/stock')} className="text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
                  <StatCard
                    label="Low Stock"
                    value={String(lowStockFeed?.low.length ?? 0)}
                    icon={AlertTriangle}
                    tone={(lowStockFeed?.low.length ?? 0) > 0 ? 'warn' : 'default'}
                    hint="Products at or below minimum stock"
                    className="h-full"
                  />
                </button>
              </>
            )}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <section className="card p-5 min-w-0">
              <PanelHeader title="Cash Flow" caption="Last 30 days · payments recorded">
                <LegendChip color="bg-emerald-500" label="Received" />
                <LegendChip color="bg-rose-500" label="Paid out" />
                <LegendChip color="bg-indigo-500" label="Net" />
              </PanelHeader>
              {isLoading ? (
                <div className="h-64 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
              ) : (
                <div className="h-64 -ml-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cashflowSeries} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                      <defs>
                        <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradMade" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.40} />
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.30} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-secondary-200 dark:stroke-secondary-800" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} className="fill-secondary-400" axisLine={false} tickLine={false} minTickGap={24} tickMargin={6} />
                      <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 11 }} className="fill-secondary-400" axisLine={false} tickLine={false} width={58} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#a1a1aa', strokeWidth: 1, strokeDasharray: '4 4' }} />
                      <Area type="monotone" dataKey="received" name="Received" stroke="#10b981" strokeWidth={2} fill="url(#gradReceived)" />
                      <Area type="monotone" dataKey="made" name="Paid out" stroke="#f43f5e" strokeWidth={2} fill="url(#gradMade)" />
                      <Area type="monotone" dataKey="net" name="Net" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 3" fill="url(#gradNet)" fillOpacity={0.6} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="card p-5 min-w-0">
              <PanelHeader title="Sales vs Purchases" caption="Last 14 days · booked documents">
                <LegendChip color="bg-emerald-500" label="Sales" />
                <LegendChip color="bg-rose-500" label="Purchases" />
              </PanelHeader>
              {isLoading ? (
                <div className="h-64 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
              ) : (
                <div className="h-64 -ml-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={spSeries} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-secondary-200 dark:stroke-secondary-800" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} className="fill-secondary-400" axisLine={false} tickLine={false} minTickGap={16} tickMargin={6} />
                      <YAxis tickFormatter={compactCurrency} tick={{ fontSize: 11 }} className="fill-secondary-400" axisLine={false} tickLine={false} width={58} />
                      <Tooltip content={<ChartTooltip />} cursor={{ className: 'fill-secondary-100 dark:fill-secondary-800/50' }} />
                      <Bar dataKey="sales" name="Sales" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={18} />
                      <Bar dataKey="purchases" name="Purchases" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>

          {/* AR/AP position (existing aggregates only) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <section className="rounded-xl border border-emerald-200/70 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/[0.04] p-5">
              <PanelHeader title="Accounts Receivable" caption="Open balance across issued & partially paid invoices" />
              {isLoading ? (
                <div className="h-12 w-40 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
              ) : (
                <div className="flex items-end justify-between gap-4">
                  <p className="font-sans font-semibold text-2xl tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400 leading-none">
                    {formatCurrency(dash?.receivables?.total ?? 0, sym)}
                  </p>
                  <div className="text-right">
                    <p className="text-xs tabular-nums text-secondary-500 dark:text-secondary-400">
                      New (30d) {formatCurrency(dash?.receivables?.currentPeriodNew ?? 0, sym)}
                    </p>
                    {receivableDelta !== null && (
                      <p className={`text-xs tabular-nums mt-0.5 ${receivableDelta >= 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}`}>
                        {receivableDelta >= 0 ? '▲' : '▼'} {Math.abs(receivableDelta)}% vs prior 30d
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-rose-200/70 dark:border-rose-500/20 bg-rose-50/40 dark:bg-rose-500/[0.04] p-5">
              <PanelHeader title="Accounts Payable" caption="Open balance across confirmed & partially paid bills" />
              {isLoading ? (
                <div className="h-12 w-40 rounded-lg bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
              ) : (
                <div className="flex items-end justify-between gap-4">
                  <p className="font-sans font-semibold text-2xl tabular-nums tracking-tight text-rose-700 dark:text-rose-400 leading-none">
                    {formatCurrency(dash?.payables?.total ?? 0, sym)}
                  </p>
                  <div className="text-right">
                    <p className="text-xs tabular-nums text-secondary-500 dark:text-secondary-400">
                      New (30d) {formatCurrency(dash?.payables?.currentPeriodNew ?? 0, sym)}
                    </p>
                    {payableDelta !== null && (
                      <p className={`text-xs tabular-nums mt-0.5 ${payableDelta >= 0 ? 'text-warning-600 dark:text-warning-400' : 'text-success-600 dark:text-success-400'}`}>
                        {payableDelta >= 0 ? '▲' : '▼'} {Math.abs(payableDelta)}% vs prior 30d
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Activity + alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <section className="card p-5">
              <PanelHeader title="Recent Sales">
                <button onClick={() => navigate('/app/sales-invoices')} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">View all</button>
              </PanelHeader>
              {recentInvoices && recentInvoices.length > 0 ? (
                <div className="space-y-1">
                  {recentInvoices.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between py-2 border-b border-secondary-100 dark:border-secondary-800 last:border-0 cursor-pointer table-row-hover rounded-lg px-1 -mx-1" onClick={() => navigate(`/app/sales-invoices/${inv.id}`)}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">{customerNames?.[inv.customer_id] || 'Customer'}</p>
                        <p className="text-xs text-secondary-400 figure">{inv.invoice_number}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="figure text-sm text-secondary-700 dark:text-secondary-300 block">{formatCurrency(inv.grand_total, sym)}</span>
                        <StatusBadge status={String(inv.status)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-8 w-8 text-secondary-300 mx-auto mb-2" />
                  <p className="text-sm text-secondary-400">No sales yet</p>
                </div>
              )}
            </section>

            <section className="card p-5">
              <PanelHeader title="Recent Purchases">
                <button onClick={() => navigate('/app/purchase-bills')} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">View all</button>
              </PanelHeader>
              {recentBills && recentBills.length > 0 ? (
                <div className="space-y-1">
                  {recentBills.map((bill: any) => (
                    <div key={bill.id} className="flex items-center justify-between py-2 border-b border-secondary-100 dark:border-secondary-800 last:border-0 cursor-pointer table-row-hover rounded-lg px-1 -mx-1" onClick={() => navigate('/app/purchase-bills')}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">{supplierNames?.[bill.supplier_id] || 'Supplier'}</p>
                        <p className="text-xs text-secondary-400 figure">{bill.bill_number}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="figure text-sm text-secondary-700 dark:text-secondary-300 block">{formatCurrency(bill.grand_total, sym)}</span>
                        <StatusBadge status={String(bill.status)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <ShoppingCart className="h-8 w-8 text-secondary-300 mx-auto mb-2" />
                  <p className="text-sm text-secondary-400">No purchases yet</p>
                </div>
              )}
            </section>

            <section className="card p-5">
              <PanelHeader title="Recent Payments">
                <button onClick={() => navigate('/app/payments-received')} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">View all</button>
              </PanelHeader>
              {recentPayments && recentPayments.length > 0 ? (
                <div className="space-y-1">
                  {recentPayments.map((pay: any) => (
                    <div key={pay.id} className="flex items-center justify-between py-2 border-b border-secondary-100 dark:border-secondary-800 last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate figure">{pay.payment_number}</p>
                        <p className="text-xs text-secondary-400">{formatDate(pay.date)}</p>
                      </div>
                      <span className={`figure text-sm shrink-0 ${pay.type === 'received' ? 'text-success-600 dark:text-success-400' : 'text-error-600 dark:text-error-400'}`}>
                        {formatCurrency(pay.amount, sym)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Banknote className="h-8 w-8 text-secondary-300 mx-auto mb-2" />
                  <p className="text-sm text-secondary-400">No payments yet</p>
                </div>
              )}
            </section>
          </div>

          {/* Outstanding invoices */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100">Outstanding Invoices</h3>
              <span className="text-[11px] text-secondary-400">issued or partially paid · recent activity</span>
            </div>
            {isLoading ? (
              <div className="h-16 rounded-xl bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
            ) : outstandingInvoices.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {outstandingInvoices.map((inv: any) => (
                  <button key={inv.id} type="button" onClick={() => navigate(`/app/sales-invoices/${inv.id}`)} className="card-solid p-3 rounded-xl flex items-center justify-between hover:shadow-md transition-shadow text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-secondary-900 dark:text-secondary-100 truncate">{customerNames?.[inv.customer_id] || 'Customer'}</p>
                      <p className="text-xs text-secondary-400 figure">{inv.invoice_number} · {formatDate(inv.invoice_date)}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="figure text-sm font-semibold text-secondary-900 dark:text-secondary-100">{formatCurrency(inv.grand_total, sym)}</p>
                      <StatusBadge status={String(inv.status)} />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-secondary-200 dark:border-zinc-800 p-5 text-center">
                <Receipt className="h-6 w-6 text-secondary-300 mx-auto mb-1.5" />
                <p className="text-sm text-secondary-400">No open invoices among recent activity</p>
              </div>
            )}
          </section>

          {/* Low stock strip */}
          <section className="card p-5">
            <PanelHeader title="Low Stock Alerts" caption="At or below minimum quantity">
              <AlertTriangle className="h-4 w-4 text-warning-500" />
            </PanelHeader>
            {lowStockFeed && lowStockFeed.low.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {lowStockFeed.low.slice(0, 6).map((p) => (
                  <button key={p.id} type="button" onClick={() => navigate('/app/stock')} className="flex items-center justify-between p-2.5 rounded-lg bg-warning-50 dark:bg-warning-900/20 hover:shadow-card-hover transition-all text-left">
                    <span className="text-sm text-secondary-700 dark:text-secondary-300 truncate">{p.name}</span>
                    <span className="badge bg-amber-100 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 figure shrink-0 ml-2">{p.current_stock} left</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Package className="h-7 w-7 text-secondary-300 mx-auto mb-2" />
                <p className="text-sm text-secondary-400">No low stock items</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
