import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';

const PAGE_SIZES = [10, 25, 50];

export function ListToolbar(props: {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
}) {
  return (
    <div className="p-4 border-b border-secondary-200 dark:border-secondary-800 flex flex-wrap items-center gap-3">
      <div className="relative max-w-sm flex-1 min-w-[12rem]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary-400" />
        <Input
          placeholder={props.placeholder}
          value={props.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-secondary-500 dark:text-secondary-400 ml-auto">
        Rows
        <select
          className="input w-auto py-1.5 text-xs"
          value={props.pageSize}
          onChange={(e) => props.onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
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
