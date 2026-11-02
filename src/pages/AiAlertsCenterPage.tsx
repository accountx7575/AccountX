import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BellRing, Package, ReceiptText, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageMotion } from '@/lib/motion';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { fetchReceivablesAging, fetchPayablesAging, fetchGstSummary } from '@/lib/gst/client';
import type { AgingRow } from '@/lib/gst/client';

/**
 * Smart Alerts Center — T119 free-start item 2.
 * Every alert is computed from real accounting surfaces (aging RPCs, products,
 * GST summary). No synthetic deadlines, no invented numbers. Route target
 * proposal: /app/alerts (wired at integration by god).
 */

type Severity = 'error' | 'warn' | 'info';

type AlertCard = {
  id: string;
  title: string;
  reason: string;
  figureLabel: string;
  figure: string;
  countLine: string | null;
  periodLabel: string;
  severity: Severity;
  actionTo: string;
  actionLabel: string;
};

const SEVERITY_TONE: Record<Severity, string> = {
  error: 'border-error-200 dark:border-error-800 bg-error-50/50 dark:bg-error-900/15',
  warn: 'border-warning-300 dark:border-warning-700 bg-warning-50/50 dark:bg-warning-900/15',
  info: 'border-secondary-200 dark:border-secondary-700 bg-white dark:bg-secondary-800/60',
};

const SEVERITY_BADGE: Record<Severity, string> = {
  error: 'bg-error-100 text-error-700 dark:bg-error-900/40 dark:text-error-300',
  warn: 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300',
  info: 'bg-secondary-100 text-secondary-600 dark:bg-zinc-800 dark:text-zinc-300',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysPast(dueDate: string): number {
  return Math.floor((Date.now() - new Date(dueDate + 'T00:00:00').getTime()) / 86_400_000);
}

function topParties(rows: AgingRow[], n = 3): string | null {
  const named = rows.filter((r) => r.party_name);
  if (named.length === 0) return null;
  const uniq = Array.from(new Map(named.map((r) => [r.party_name as string, r])).values());
  return uniq.slice(0, n).map((r) => r.party_name).join(', ');
}

export function AiAlertsCenterPage() {
  const { activeBusiness } = useAuth();
  const navigate = useNavigate();
  const bid = activeBusiness?.id;

  const arQ = useQuery({
    queryKey: ['alerts-receivables', bid],
    queryFn: () => fetchReceivablesAging(bid!),
    enabled: !!bid,
  });
  const apQ = useQuery({
    queryKey: ['alerts-payables', bid],
    queryFn: () => fetchPayablesAging(bid!),
    enabled: !!bid,
  });
  const lowStockQ = useQuery({
    queryKey: ['alerts-low-stock', bid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, current_stock, minimum_stock')
        .eq('business_id', bid!);
      if (error) throw error;
      return ((data || []) as { id: string; name: string; current_stock: number; minimum_stock: number }[]).filter(
        (p) => p.minimum_stock > 0 && p.current_stock <= p.minimum_stock
      );
    },
    enabled: !!bid,
  });
  const gstQ = useQuery({
    queryKey: ['alerts-gst', bid],
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      const rows = await fetchGstSummary(bid!, from, to);
      return { rows, from, to };
    },
    enabled: !!bid,
  });

  const cards = useMemo<AlertCard[]>(() => {
    const out: AlertCard[] = [];
    const asOf = today();

    const arRows = (arQ.data || []).filter((r) => (r.outstanding ?? 0) > 0 && r.due_date && r.due_date < asOf);
    if (arRows.length > 0) {
      const totalOverdue = arRows.reduce((s, r) => s + (r.outstanding ?? 0), 0);
      const worstDays = Math.max(...arRows.map((r) => daysPast(r.due_date as string)));
      const parties = topParties(arRows);
      out.push({
        id: 'ar-overdue',
        title: 'Receivables overdue',
        reason:
          worstDays > 30
            ? `Some customer invoices are more than 30 days past their due date${parties ? ` — including ${parties}` : ''}.`
            : `Customer invoices have crossed their due date${parties ? ` — including ${parties}` : ''}.`,
        figureLabel: 'Total overdue',
        figure: formatCurrency(totalOverdue),
        countLine: `Overdue invoices: ${arRows.length}`,
        periodLabel: `As of ${asOf}`,
        severity: worstDays > 30 ? 'error' : 'warn',
        actionTo: '/app/receivables',
        actionLabel: 'View Receivables',
      });
    }

    const apDue = (apQ.data || []).filter(
      (r) => (r.outstanding ?? 0) > 0 && r.due_date && daysPast(r.due_date) >= -7
    );
    if (apDue.length > 0) {
      const total = apDue.reduce((s, r) => s + (r.outstanding ?? 0), 0);
      const overdueCount = apDue.filter((r) => (r.due_date as string) < asOf).length;
      const parties = topParties(apDue);
      out.push({
        id: 'ap-due',
        title: overdueCount > 0 ? 'Supplier bills overdue' : 'Supplier bills due soon',
        reason:
          overdueCount > 0
            ? `${overdueCount} supplier bill(s) are past their due date${parties ? ` — including ${parties}` : ''}.`
            : `Supplier bills fall due within the next 7 days${parties ? ` — including ${parties}` : ''}.`,
        figureLabel: overdueCount > 0 ? 'Overdue to suppliers' : 'Due within 7 days',
        figure: formatCurrency(total),
        countLine: `Bills: ${apDue.length}`,
        periodLabel: `As of ${asOf}`,
        severity: overdueCount > 0 ? 'error' : 'warn',
        actionTo: '/app/payables',
        actionLabel: 'View Payables',
      });
    }

    const low = lowStockQ.data || [];
    if (low.length > 0) {
      const names = low.slice(0, 3).map((p) => p.name).join(', ');
      out.push({
        id: 'low-stock',
        title: 'Low stock',
        reason: `${low.length} product(s) are at or below their minimum stock level${low.length > 3 ? `, starting with ${names}` : `: ${names}`}.`,
        figureLabel: 'Products below minimum',
        figure: String(low.length),
        countLine: null,
        periodLabel: 'Current stock',
        severity: 'warn',
        actionTo: '/app/stock',
        actionLabel: 'View Stock',
      });
    }

    if (gstQ.data) {
      const summaryRow = gstQ.data.rows.find((r) => r.section === 'Summary');
      const net = summaryRow?.net_amount ?? null;
      if (net !== null && net !== 0) {
        out.push({
          id: 'gst-position',
          title: net > 0 ? 'GST net payable this month' : 'GST credit position this month',
          reason:
            net > 0
              ? 'Your outward tax exceeds input credit for this month so far — set aside funds before filing.'
              : 'Input credit currently exceeds outward tax this month — a carry-forward position.',
          figureLabel: net > 0 ? 'Net GST payable' : 'Net credit',
          figure: formatCurrency(Math.abs(net)),
          countLine: null,
          periodLabel: gstQ.data.from + ' → ' + gstQ.data.to,
          severity: 'info',
          actionTo: '/app/gst',
          actionLabel: 'View GST',
        });
      }
    }

    return out;
  }, [arQ.data, apQ.data, lowStockQ.data, gstQ.data]);

  const loading = arQ.isLoading || apQ.isLoading || lowStockQ.isLoading || gstQ.isLoading;
  const failed = [arQ, apQ, lowStockQ, gstQ].filter((q) => q.isError);

  return (
    <PageMotion>
      <PageHeader
        title="Alerts"
        subtitle="What needs attention right now — computed live from your books"
        meta={
          activeBusiness ? (
            <span className="badge bg-secondary-100 text-secondary-600 dark:bg-zinc-800 dark:text-zinc-300 border-transparent">
              {activeBusiness.name}
            </span>
          ) : undefined
        }
      />

      {!activeBusiness ? (
        <EmptyState icon={BellRing} title="No business selected" description="Choose a business to see its alerts." />
      ) : loading ? (
        <div className="space-y-3" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-secondary-100 dark:bg-secondary-800 animate-pulse" />
          ))}
        </div>
      ) : failed.length === 4 ? (
        <ErrorState title="Unable to load alerts." message="The alert data sources are not reachable yet." onRetry={() => failed.forEach((q) => void q.refetch())} />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No alerts right now"
          description="Nothing is overdue, below minimum stock, or needs a look. New alerts appear here automatically."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {cards.map((c) => (
            <div key={c.id} className={`card p-5 border ${SEVERITY_TONE[c.severity]} flex flex-col gap-2`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {c.severity === 'info' ? (
                    <ReceiptText className="h-4 w-4 text-secondary-400 shrink-0" />
                  ) : c.id === 'low-stock' ? (
                    <Package className="h-4 w-4 text-warning-500 shrink-0" />
                  ) : (
                    <Wallet className="h-4 w-4 text-error-500 shrink-0" />
                  )}
                  <h3 className="text-sm font-semibold text-secondary-900 dark:text-secondary-100 truncate">{c.title}</h3>
                </div>
                <span className={`badge ${SEVERITY_BADGE[c.severity]} shrink-0`}>
                  {c.severity === 'error' ? 'Critical' : c.severity === 'warn' ? 'Attention' : 'Info'}
                </span>
              </div>
              <p className="text-xs text-secondary-500 dark:text-secondary-400 leading-relaxed">{c.reason}</p>
              <div className="mt-auto pt-1 flex items-end justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-caption font-medium uppercase tracking-[0.06em]">{c.figureLabel}</p>
                  <p className="font-sans font-semibold text-xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">{c.figure}</p>
                  {c.countLine && <p className="text-[11px] text-secondary-400">{c.countLine}</p>}
                  <p className="text-[10px] text-secondary-400 mt-0.5">{c.periodLabel}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => navigate(c.actionTo)}>
                  {c.actionLabel}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && failed.length > 0 && failed.length < 4 && (
        <div className="mt-4 rounded-xl border border-warning-300 dark:border-warning-700 bg-warning-50/60 dark:bg-warning-900/20 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-warning-800 dark:text-warning-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Some alert sources could not be loaded — shown alerts may be incomplete.
          </p>
          <Button size="sm" variant="secondary" onClick={() => failed.forEach((q) => void q.refetch())}>
            Retry
          </Button>
        </div>
      )}
    </PageMotion>
  );
}
