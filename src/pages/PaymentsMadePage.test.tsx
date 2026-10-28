// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentsMadePage } from '@/pages/PaymentsMadePage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const mockBusiness = { id: 'biz-1', currency_symbol: '₹' };
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: mockBusiness }),
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const printPaymentVoucherMock = vi.fn();
vi.mock('@/lib/receiptPrint', () => ({
  printPaymentVoucher: (...args: any[]) => printPaymentVoucherMock(...args),
}));

const mockPayments = [
  {
    id: 'pay-made-1',
    business_id: 'biz-1',
    type: 'made',
    party_type: 'supplier',
    party_id: 'supp-tata',
    payment_number: 'PAY/26-27/1',
    date: '2026-10-28',
    amount: 15000,
    allocated_amount: 15000,
    payment_method: 'bank',
    reference: 'UTR987654',
    notes: null,
    bill_id: 'bill-1',
    created_at: '2026-10-28T10:00:00Z',
  },
  {
    id: 'pay-made-2',
    business_id: 'biz-1',
    type: 'made',
    party_type: 'supplier',
    party_id: 'supp-tata',
    payment_number: 'PAY/26-27/2',
    date: '2026-10-28',
    amount: 5000,
    allocated_amount: 0,
    payment_method: 'cash',
    reference: null,
    notes: 'Advance payment',
    bill_id: null,
    created_at: '2026-10-28T11:00:00Z',
  },
];

const mockSuppliers = [
  { id: 'supp-tata', name: 'Tata Power Solar', email: 'tata@example.com', phone: '9876543210' },
];

const deleteMock = vi.fn();
const updateMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: (cols?: string) => builder,
        eq: (col: string, val: any) => builder,
        ilike: (col: string, val: any) => builder,
        in: (col: string, vals: any) => builder,
        neq: (col: string, val: any) => builder,
        order: (col: string, opts?: any) => builder,
        delete: () => {
          deleteMock(table);
          return builder;
        },
        update: (payload: any) => {
          updateMock(table, payload);
          return builder;
        },
        maybeSingle: () => {
          if (table === 'purchase_bills') {
            return Promise.resolve({
              data: { id: 'bill-1', paid_amount: 15000, grand_total: 20000, balance_amount: 5000, status: 'partially_paid' },
              error: null,
            });
          }
          if (table === 'suppliers') {
            return Promise.resolve({
              data: { id: 'supp-tata', opening_balance: 0, current_balance: 5000, total_paid: 20000 },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: any, reject?: any) => {
          if (table === 'payments') {
            return Promise.resolve({ data: mockPayments, error: null }).then(resolve, reject);
          }
          if (table === 'suppliers') {
            return Promise.resolve({ data: mockSuppliers, error: null }).then(resolve, reject);
          }
          if (table === 'purchase_bills') {
            return Promise.resolve({ data: [{ id: 'bill-1', bill_number: 'PB/26-27/001' }], error: null }).then(resolve, reject);
          }
          if (table === 'journal_entries') {
            return Promise.resolve({ data: [{ id: 'je-1' }], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

describe('PaymentsMadePage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    navigateMock.mockReset();
    toastMock.mockReset();
    deleteMock.mockReset();
    updateMock.mockReset();
    printPaymentVoucherMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('displays recorded payments PAY/26-27/1 (₹15,000) and PAY/26-27/2 (₹5,000) with Tata Power Solar', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsMadePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify payments appear in table
    await waitFor(() => {
      expect(screen.getByText('PAY/26-27/1')).not.toBeNull();
      expect(screen.getByText('PAY/26-27/2')).not.toBeNull();
    });

    // Verify supplier name is rendered
    const supplierCells = screen.getAllByText('Tata Power Solar');
    expect(supplierCells.length).toBeGreaterThanOrEqual(2);

    // Verify amounts
    expect(screen.getByText('₹15,000.00')).not.toBeNull();
    expect(screen.getByText('₹5,000.00')).not.toBeNull();

    // Verify subtitle count
    expect(screen.getByText('2 payments')).not.toBeNull();
  });

  it('renders View, Edit, Delete, Advice, and Print actions under the ACTIONS column', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsMadePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('PAY/26-27/1')).not.toBeNull();
    });

    // Check action buttons exist
    const viewButtons = screen.getAllByLabelText(/View payment/i);
    expect(viewButtons.length).toBe(2);

    const editButtons = screen.getAllByLabelText(/Edit payment/i);
    expect(editButtons.length).toBe(2);

    const deleteButtons = screen.getAllByLabelText(/Delete payment/i);
    expect(deleteButtons.length).toBe(2);

    const adviceButtons = screen.getAllByRole('button', { name: /^Advice$/i });
    expect(adviceButtons.length).toBe(2);

    const printButtons = screen.getAllByLabelText(/Print voucher/i);
    expect(printButtons.length).toBe(2);

    // Clicking View navigates to /app/payments-made/:id
    fireEvent.click(viewButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-made/pay-made-1');

    // Clicking payment number link navigates to /app/payments-made/:id
    fireEvent.click(screen.getByText('PAY/26-27/1'));
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-made/pay-made-1');

    // Clicking Edit navigates to /app/payments-made/:id/edit
    fireEvent.click(editButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-made/pay-made-1/edit');

    // Clicking Print triggers printPaymentVoucher
    fireEvent.click(printButtons[0]);
    expect(printPaymentVoucherMock).toHaveBeenCalledTimes(1);
    expect(printPaymentVoucherMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-made-1',
        payment_number: 'PAY/26-27/1',
      }),
      mockBusiness
    );
  });

  it('handles Delete action with confirmation dialog and triggers deletion workflow', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsMadePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('PAY/26-27/1')).not.toBeNull();
    });

    const deleteButtons = screen.getAllByLabelText(/Delete payment/i);
    fireEvent.click(deleteButtons[0]);

    // Check confirmation dialog opens with expected message
    await waitFor(() => {
      expect(
        screen.getByText(/Are you sure you want to delete Payment PAY\/26-27\/1\? This will reverse ledger entries and restore supplier balance\./i)
      ).not.toBeNull();
    });

    // Click confirm in the dialog
    const confirmButton = screen.getByRole('button', { name: /^Delete$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('payments');
      expect(toastMock).toHaveBeenCalledWith('Payment deleted successfully', 'success');
    });
  });
});
