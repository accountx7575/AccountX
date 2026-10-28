// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentsReceivedPage } from '@/pages/PaymentsReceivedPage';

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

const printPaymentReceiptMock = vi.fn();
vi.mock('@/lib/receiptPrint', () => ({
  printPaymentReceipt: (...args: any[]) => printPaymentReceiptMock(...args),
}));

const mockPayments = [
  {
    id: 'pay-1',
    business_id: 'biz-1',
    type: 'received',
    party_type: 'customer',
    party_id: 'cust-sharma',
    payment_number: 'RCP/26-27/1',
    date: '2026-10-28',
    amount: 20000,
    allocated_amount: 0,
    payment_method: 'cash',
    reference: null,
    notes: null,
    invoice_id: null,
    created_at: '2026-10-28T10:00:00Z',
  },
  {
    id: 'pay-2',
    business_id: 'biz-1',
    type: 'received',
    party_type: 'customer',
    party_id: 'cust-sharma',
    payment_number: 'RCP/26-27/2',
    date: '2026-10-28',
    amount: 19000,
    allocated_amount: 0,
    payment_method: 'bank',
    reference: 'UTR123456',
    notes: null,
    invoice_id: null,
    created_at: '2026-10-28T11:00:00Z',
  },
];

const mockCustomers = [
  { id: 'cust-sharma', name: 'Sharma', email: 'sharma@example.com', phone: '9876543210' },
];

const deleteMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: (cols?: string) => builder,
        eq: (col: string, val: any) => builder,
        ilike: (col: string, val: any) => builder,
        in: (col: string, vals: any) => builder,
        order: (col: string, opts?: any) => builder,
        delete: () => {
          deleteMock(table);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any, reject?: any) => {
          if (table === 'payments') {
            return Promise.resolve({ data: mockPayments, error: null }).then(resolve, reject);
          }
          if (table === 'customers') {
            return Promise.resolve({ data: mockCustomers, error: null }).then(resolve, reject);
          }
          if (table === 'sales_invoices') {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  },
}));

describe('PaymentsReceivedPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    navigateMock.mockReset();
    toastMock.mockReset();
    deleteMock.mockReset();
    printPaymentReceiptMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('displays recorded receipts RCP/26-27/1 (₹20,000) and RCP/26-27/2 (₹19,000) with Sharma as customer', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsReceivedPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify payments appear in table
    await waitFor(() => {
      expect(screen.getByText('RCP/26-27/1')).not.toBeNull();
      expect(screen.getByText('RCP/26-27/2')).not.toBeNull();
    });

    // Verify customer name 'Sharma' is rendered for the payments
    const sharmaCells = screen.getAllByText('Sharma');
    expect(sharmaCells.length).toBeGreaterThanOrEqual(2);

    // Verify amounts
    expect(screen.getByText('₹20,000.00')).not.toBeNull();
    expect(screen.getByText('₹19,000.00')).not.toBeNull();

    // Verify subtitle count
    expect(screen.getByText('2 payments')).not.toBeNull();
  });

  it('renders View, Edit, Delete, Receipt, and Print actions under the ACTIONS column', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsReceivedPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('RCP/26-27/1')).not.toBeNull();
    });

    // Check action buttons exist
    const viewButtons = screen.getAllByLabelText(/View receipt/i);
    expect(viewButtons.length).toBe(2);

    const editButtons = screen.getAllByLabelText(/Edit payment/i);
    expect(editButtons.length).toBe(2);

    const deleteButtons = screen.getAllByLabelText(/Delete payment/i);
    expect(deleteButtons.length).toBe(2);

    const receiptButtons = screen.getAllByRole('button', { name: /^Receipt$/i });
    expect(receiptButtons.length).toBe(2);

    const printButtons = screen.getAllByLabelText(/Print Receipt/i);
    expect(printButtons.length).toBe(2);

    // Clicking View navigates to /app/payments-received/:id
    fireEvent.click(viewButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received/pay-1');

    // Clicking receipt number link navigates to /app/payments-received/:id
    fireEvent.click(screen.getByText('RCP/26-27/1'));
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received/pay-1');

    // Clicking Edit navigates to /app/payments-received/:id/edit
    fireEvent.click(editButtons[0]);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received/pay-1/edit');

    // Clicking Print triggers printPaymentReceipt
    fireEvent.click(printButtons[0]);
    expect(printPaymentReceiptMock).toHaveBeenCalledTimes(1);
    expect(printPaymentReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-1',
        payment_number: 'RCP/26-27/1',
      }),
      mockBusiness
    );
  });

  it('handles Delete action with confirmation and triggers removal', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsReceivedPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('RCP/26-27/1')).not.toBeNull();
    });

    const deleteButtons = screen.getAllByLabelText(/Delete payment/i);
    fireEvent.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('RCP/26-27/1'));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith('payments');
    });

    confirmSpy.mockRestore();
  });

  it('removes unwanted horizontal scroller classes (overflow-x-auto, scrollbar-thin)', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentsReceivedPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('RCP/26-27/1')).not.toBeNull();
    });

    expect(container.querySelector('.overflow-x-auto')).toBeNull();
    expect(container.querySelector('.scrollbar-thin')).toBeNull();
  });
});
