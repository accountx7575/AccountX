import type { LucideIcon } from 'lucide-react';
import { Building2 } from 'lucide-react';

export function SuperAdminPlaceholder({ title, blurb, icon: Icon = Building2 }: {
  title: string;
  blurb: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary-100 dark:bg-primary-950/50 p-2 text-primary-600 dark:text-primary-400">
          <Icon className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-bold text-secondary-900 dark:text-white">{title}</h1>
      </div>
      <div className="card-solid p-8 text-center">
        <p className="text-sm font-medium text-secondary-700 dark:text-secondary-200">Workspace reserved</p>
        <p className="text-sm text-secondary-400 mt-1 max-w-md mx-auto">{blurb}</p>
      </div>
    </div>
  );
}
