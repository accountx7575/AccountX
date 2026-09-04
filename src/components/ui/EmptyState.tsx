import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-up">
      <div className="rounded-2xl bg-gradient-to-br from-primary-50 to-secondary-100 dark:from-primary-900/20 dark:to-secondary-800/60 ring-1 ring-secondary-200/70 dark:ring-secondary-700/60 p-4 mb-5">
        <Icon className="h-7 w-7 text-primary-500/80 dark:text-primary-400/80" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-secondary-900 dark:text-secondary-100 mb-1">{title}</h3>
      {description && <p className="text-sm text-secondary-500 dark:text-secondary-400 max-w-sm mb-5 leading-relaxed">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
