import { type ReactNode } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

type FilterBarProps = {
  search?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  dateRange?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/**
 * List-page filter row: search input + arbitrary selects (children) +
 * date-range slot + right-aligned actions. Wraps gracefully on mobile.
 */
export function FilterBar({ search, onSearchChange, searchPlaceholder = 'Search...', children, dateRange, actions, className }: FilterBarProps) {
  const hasFilters = (search !== undefined && onSearchChange) || children || dateRange;
  if (!hasFilters && !actions) return null;

  return (
    <div
      data-testid="filter-bar"
      className={cn(
        'flex flex-wrap items-center gap-3 p-4 border-b border-secondary-200/80 dark:border-secondary-800 bg-white/60 dark:bg-secondary-900/40 rounded-t-xl',
        !hasFilters && 'justify-end',
        className
      )}
    >
      {search !== undefined && onSearchChange && (
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="input h-9 pl-10 rounded-lg text-[13px]"
          />
        </div>
      )}
      {children}
      {dateRange && <div className="flex items-center gap-2">{dateRange}</div>}
      <div className="flex items-center gap-2 ml-auto">
        {(children || dateRange) && <SlidersHorizontal className="h-3.5 w-3.5 text-secondary-300 dark:text-secondary-600" aria-hidden="true" />}
        {actions}
      </div>
    </div>
  );
}
