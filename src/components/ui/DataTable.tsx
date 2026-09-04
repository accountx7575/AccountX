import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DataTableColumn<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
  loading?: boolean;
  stickyHeader?: boolean;
  mobileCard?: (row: T) => ReactNode;
  className?: string;
};

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3.5">
              <div className="h-3.5 rounded-md bg-secondary-100 dark:bg-secondary-800 animate-pulse" style={{ width: `${55 + ((r * 13 + c * 29) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Generic table for list pages. Right-aligned numeric columns should pair
 * align:'right' with the .figure class via column className/render.
 * On mobile (<md), renders mobileCard(row) list instead of the table.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyState, loading, stickyHeader, mobileCard, className }: DataTableProps<T>) {
  if (mobileCard && rows.length > 0 && !loading) {
    return (
      <div className={cn('md:hidden divide-y divide-secondary-100 dark:divide-secondary-800', className)}>
        {rows.map((row, i) => (
          <div
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn('px-4 py-3 transition-colors', onRowClick && 'cursor-pointer table-row-hover')}
          >
            {mobileCard(row)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('hidden md:block overflow-x-auto scrollbar-thin w-full', className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className={cn(stickyHeader && 'sticky top-0 z-10')}>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={cn('px-4 py-2.5 border-b border-secondary-200 dark:border-secondary-800 bg-inherit', alignClass[col.align ?? 'left'])}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows cols={columns.length} />
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {emptyState ?? null}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                className={cn('table-row-hover border-b border-secondary-100 dark:border-secondary-800/70 last:border-b-0', onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3.5 text-secondary-700 dark:text-secondary-300', alignClass[col.align ?? 'left'], col.className)}>
                    {col.render ? col.render(row) : (row as Record<string, ReactNode>)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
