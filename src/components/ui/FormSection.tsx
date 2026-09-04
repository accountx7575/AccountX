import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FormSectionProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Titled fieldset with optional description and divider rhythm for create-pages. */
export function FormSection({ title, description, actions, children, className }: FormSectionProps) {
  return (
    <section className={cn('border-t border-secondary-200/80 dark:border-secondary-800 pt-5 mt-5 first:border-t-0 first:pt-0 first:mt-0', className)}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-section-title">{title}</h3>
          {description && <p className="text-caption mt-0.5 leading-snug">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
