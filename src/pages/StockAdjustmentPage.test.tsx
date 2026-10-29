// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { StockAdjustmentPage } from './StockAdjustmentPage';

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockToast = vi.fn();

const mockProducts = [
  { id: 'prod-1', name: 'PREMIERE KIT 620 WT', current_stock: 2, unit: 'PCS', type: 'product' },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: (cols: string) => ({
            eq: (col1: string, val1: any) => ({
              eq: (col2: string, val2: any) => {
                // Check if single() will be chained
                return {
                  order: () => Promise.resolve({ data: mockProducts, error: null }),
                  single: () => Promise.resolve({ data: mockProducts[0], error: null }),
                };
              },
              single: () => Promise.resolve({ data: mockProducts[0], error: null }),
            }),
          }),
          update: (fields: any) => {
            mockUpdate(fields);
            return {
              eq: () => ({
                eq: () => Promise.resolve({ data: null, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'stock_adjustments') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: (payload: any) => {
            mockInsert(payload);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'adj-1', ...payload }, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'stock_movements') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      return {};
    },
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    activeBusiness: { id: 'biz-1', name: 'Acme Corp' },
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('StockAdjustmentPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders form and handles 1 PCS Stock Out reduction correctly', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StockAdjustmentPage />
      </QueryClientProvider>
    );

    // Wait for product select to populate
    await waitFor(() => {
      expect(screen.getByText(/PREMIERE KIT 620 WT/)).toBeDefined();
    });

    // Select product
    const productSelect = screen.getByLabelText(/Product/);
    fireEvent.change(productSelect, { target: { value: 'prod-1' } });

    // Select Stock Out
    const typeSelect = screen.getByLabelText(/Adjustment Type/);
    fireEvent.change(typeSelect, { target: { value: 'Stock Out' } });

    // Enter quantity 1
    const qtyInput = screen.getByPlaceholderText('0');
    fireEvent.change(qtyInput, { target: { value: '1' } });

    // Reason
    const reasonInput = screen.getByPlaceholderText('Reason for adjustment...');
    fireEvent.change(reasonInput, { target: { value: 'Damaged item' } });

    // Click Apply Adjustment
    const applyButton = screen.getByRole('button', { name: /Apply Adjustment/i });
    fireEvent.click(applyButton);

    await waitFor(() => {
      // Verify inserted into stock_adjustments with Stock Out
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          business_id: 'biz-1',
          product_id: 'prod-1',
          adjustment_type: 'Stock Out',
          quantity: 1,
          reason: 'Damaged item',
        })
      );

      // Verify products current_stock reduced from 2 to 1 (2 - 1 = 1)
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          current_stock: 1,
        })
      );

      expect(mockToast).toHaveBeenCalledWith('Stock adjusted successfully', 'success');
    });
  });

  it('handles Stock In increase correctly', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <StockAdjustmentPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/PREMIERE KIT 620 WT/)).toBeDefined();
    });

    const productSelect = screen.getByLabelText(/Product/);
    fireEvent.change(productSelect, { target: { value: 'prod-1' } });

    const typeSelect = screen.getByLabelText(/Adjustment Type/);
    fireEvent.change(typeSelect, { target: { value: 'Stock In' } });

    const qtyInput = screen.getByPlaceholderText('0');
    fireEvent.change(qtyInput, { target: { value: '5' } });

    const applyButton = screen.getByRole('button', { name: /Apply Adjustment/i });
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          business_id: 'biz-1',
          product_id: 'prod-1',
          adjustment_type: 'Stock In',
          quantity: 5,
        })
      );

      // Verify products current_stock increased from 2 to 7 (2 + 5 = 7)
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          current_stock: 7,
        })
      );
    });
  });
});
