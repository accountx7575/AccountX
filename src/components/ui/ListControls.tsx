import type { ReactNode } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';

const PAGE_SIZES = [10, 25, 50, 100];

export function ListToolbar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  children?: ReactNode;
  leftAddon?: ReactNode;
  pageSizes?: number[];
}) {
  return (
    <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full py-2.5">
      <div className="flex items-center gap-2 flex-1 max-w-md">
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
          <Input
            placeholder={props.placeholder}
            value={props.search}
            onChange={(e) => props.onSearchChange(e.target.value)}
            className="pl-10 h-9 py-0 leading-none"
          />
        </div>
        {props.leftAddon}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 justify-end">
        {props.children}
        <select
          className="input h-9 py-0 leading-none w-auto min-w-[85px] max-w-[100px] px-2.5 rounded-md text-xs"
          aria-label="Rows per page"
          value={props.pageSize}
          onChange={(e) => props.onPageSizeChange(Number(e.target.value))}
        >
          {(props.pageSizes || PAGE_SIZES).map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ListPagination(props: {
  page: number;
  onPageChange: (p: number) => void;
  pageSize: number;
  from: number;
  total: number;
  isLoading?: boolean;
}) {
  const { from, total, pageSize, page, isLoading } = props;
  if (!isLoading && total === 0) return null;
  const shownTo = Math.min(from + pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="px-4 py-3 border-t border-secondary-200 dark:border-secondary-800 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-secondary-500 dark:text-secondary-400">
        Showing <span className="figure">{from + 1}</span>&ndash;<span className="figure">{shownTo}</span> of{' '}
        <span className="figure font-medium text-secondary-700 dark:text-secondary-300">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => props.onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-md border border-secondary-200 dark:border-secondary-700 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs text-secondary-500 px-1">
          Page <span className="figure">{page}</span> of <span className="figure">{lastPage}</span>
        </span>
        <button
          onClick={() => props.onPageChange(page + 1)}
          disabled={page >= lastPage}
          className="p-1.5 rounded-md border border-secondary-200 dark:border-secondary-700 text-secondary-500 hover:bg-secondary-50 dark:hover:bg-secondary-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
