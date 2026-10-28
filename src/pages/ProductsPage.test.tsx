// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockDeleteProduct = vi.fn();
vi.mock('@/services/productService', () => ({
  deleteProduct: (...args: any[]) => mockDeleteProduct(...args),
}));

let tableRows: any[] = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: tableRows, error: null, count: tableRows.length }),
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    activeBusiness: {
      id: 'biz-1',
      name: 'Test Business',
      currency_symbol: '₹',
    },
  }),
}));

vi.mock('@/hooks/usePagedList', () => ({
  usePagedList: () => ({
    search: '',
    setSearch: vi.fn(),
    debouncedSearch: '',
    page: 1,
    setPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    from: 0,
    to: 24,
  }),
  likePattern: (v: string) => `%${v.trim()}%`,
}));

import { ProductsPage } from './ProductsPage';

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const sampleProduct = {
  id: 'prod-100',
  name: 'Industrial Widget A',
  sku: 'WID-001',
  type: 'product',
  hsn_sac: '8471',
  purchase_price: 500,
  selling_price: 800,
  current_stock: 10,
  minimum_stock: 2,
  unit: 'pcs',
  tax_rate: 18,
  is_active: true,
};

describe('ProductsPage Delete Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableRows = [sampleProduct];
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Delete action button with title="Delete product" instead of Archive', async () => {
    wrap(<ProductsPage />);
    await waitFor(() => {
      expect(screen.getByText('Industrial Widget A')).toBeTruthy();
    });

    const deleteBtn = screen.getByTitle('Delete product');
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.getAttribute('aria-label')).toBe('Delete product');

    // Archive button should no longer exist
    expect(screen.queryByTitle('Archive product')).toBeNull();
  });

  it('opens confirmation modal with "Delete Product?" title and permanent delete text', async () => {
    wrap(<ProductsPage />);
    await waitFor(() => {
      expect(screen.getByText('Industrial Widget A')).toBeTruthy();
    });

    const deleteBtn = screen.getByTitle('Delete product');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText('Delete Product?')).toBeTruthy();
      expect(
        screen.getByText(
          'Are you sure you want to permanently delete this product? This action cannot be undone.'
        )
      ).toBeTruthy();
    });

    // Cancel closes dialog without deleting
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByText('Delete Product?')).toBeNull();
    });
    expect(mockDeleteProduct).not.toHaveBeenCalled();
  });

  it('calls deleteProduct and shows success toast on confirmation', async () => {
    mockDeleteProduct.mockResolvedValueOnce(undefined);

    wrap(<ProductsPage />);
    await waitFor(() => {
      expect(screen.getByText('Industrial Widget A')).toBeTruthy();
    });

    const deleteBtn = screen.getByTitle('Delete product');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText('Delete Product?')).toBeTruthy();
    });

    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    const dialogConfirmBtn = confirmButtons[confirmButtons.length - 1];
    fireEvent.click(dialogConfirmBtn);

    await waitFor(() => {
      expect(mockDeleteProduct).toHaveBeenCalledWith('biz-1', 'prod-100');
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('Product deleted successfully', 'success');
    });
  });

  it('shows error toast when deleteProduct throws warning about linked invoices or bills', async () => {
    mockDeleteProduct.mockRejectedValueOnce(
      new Error('Cannot delete product linked to existing invoices or bills. You can archive it instead.')
    );

    wrap(<ProductsPage />);
    await waitFor(() => {
      expect(screen.getByText('Industrial Widget A')).toBeTruthy();
    });

    const deleteBtn = screen.getByTitle('Delete product');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText('Delete Product?')).toBeTruthy();
    });

    const confirmButtons = screen.getAllByRole('button', { name: 'Delete' });
    const dialogConfirmBtn = confirmButtons[confirmButtons.length - 1];
    fireEvent.click(dialogConfirmBtn);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        'Cannot delete product linked to existing invoices or bills. You can archive it instead.',
        'error'
      );
    });
  });
});
