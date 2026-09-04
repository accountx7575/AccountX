import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeProps = {
  children: ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';
  className?: string;
};

const variants = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  error: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
  info: 'bg-indigo-50 text-indigo-700 border-indigo-200/80 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30',
  neutral: 'bg-zinc-100 text-zinc-600 border-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
  primary: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white border-transparent',
};

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return <span className={cn('badge', variants[variant], className)}>{children}</span>;
}
