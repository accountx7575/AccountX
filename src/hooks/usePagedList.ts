import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function likePattern(input: string): string {
  return `%${input.trim().replace(/([%_\\])/g, '\\$1')}%`;
}

export type PagedListState = {
  search: string;
  setSearch: (v: string) => void;
  debouncedSearch: string;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  setPageSize: (n: number) => void;
  from: number;
  to: number;
};

export function usePagedList(initialPageSize = 25): PagedListState {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, pageSize]);

  const from = (page - 1) * pageSize;

  return {
    search,
    setSearch,
    debouncedSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    from,
    to: from + pageSize - 1,
  };
}
