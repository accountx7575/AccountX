import { type ReactNode } from 'react';
import { type LucideIcon, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type StatTone = 'default' | 'inflow' | 'outflow' | 'cash' | 'warn';

const iconTones: Record<StatTone, string> = {
  default: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400',
  inflow: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-emerald-500/25',
  outflow: 'bg-gradient-to-br from-rose-500 to-red-600 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-rose-500/25',
  cash: 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-indigo-500/25',
  warn: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white ring-1 ring-inset ring-white/20 shadow-lg shadow-orange-500/25',
};

type StatCardProps = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  delta?: { value: string; direction: 'up' | 'down'; caption?: string };
  hint?: string;
  footer?: ReactNode;
  className?: string;
};

export function StatCard({ label, value, icon: Icon, tone = 'default', delta, hint, footer, className }: StatCardProps) {
  return (
    <div
      title={hint}
      className={cn('card stat-glow p-5 flex flex-col gap-3', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-caption font-medium uppercase tracking-[0.06em]">{label}</p>
        {Icon && (
          <div className={cn('rounded-lg p-2 shrink-0', iconTones[tone])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-sans font-semibold text-xl tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100">{value}</span>
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-semibold rounded-full px-1.5 py-0.5 border tone-neutral',
              delta.direction === 'up' ? 'tone-success' : 'tone-error'
            )}
          >
            {delta.direction === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            <span className="figure">{delta.value}</span>
          </span>
        )}
      </div>
      {(delta?.caption || footer) && (
        <div className="mt-auto">
          {delta?.caption && <p className="text-caption">{delta.caption}</p>}
          {footer}
        </div>
      )}
    </div>
  );
}
