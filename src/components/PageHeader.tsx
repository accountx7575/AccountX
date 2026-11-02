import { type ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function PageHeader({ title, subtitle, actions, meta }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 animate-fade-up">
      <div className="min-w-0">
        <h1 className="text-page-title sm:text-2xl">{title}</h1>
        {subtitle && (
          <p className="text-[13px] text-secondary-500 dark:text-secondary-400 mt-1 leading-snug">{subtitle}</p>
        )}
        {meta && (
          <div className="flex flex-wrap items-center gap-2 mt-2 text-caption">{meta}</div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
