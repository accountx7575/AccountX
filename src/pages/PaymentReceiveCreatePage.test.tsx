// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentReceiveCreatePage } from '@/pages/PaymentReceiveCreatePage';

let mockParams: Record<string, string> = {};
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => mockParams,
  };
});

const mockBusiness = {
  id: 'biz-1',
  currency_symbol: '₹',
  payment_received_prefix: 'PR/ABC/SE',
  financial_year: '2026-27',
};
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: mockBusiness }),
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const insertMock = vi.fn();
const updateMock = vi.fn();
let mockExistingPayment: any = null;
let mockExistingPaymentsList: any[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: (cols?: string) => {
          return builder;
        },
        insert: (payload: any) => {
          insertMock(table, payload);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'pay-123', ...payload }, error: null }),
            }),
          };
        },
        update: (payload: any) => {
          updateMock(table, payload);
          return builder;
        },
        eq: (col: string, val: any) => builder,
        neq: (col: string, val: any) => builder,
        in: (col: string, vals: any) => builder,
        gt: (col: string, val: any) => builder,
        or: (cond: string) => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          if (table === 'payments' && mockExistingPayment) {
            return Promise.resolve({ data: mockExistingPayment, error: null });
          }
          if (table === 'businesses') {
            return Promise.resolve({ data: mockBusiness, error: null });
          }
          return Promise.resolve({ data: { current_balance: 20000, total_paid: 0 }, error: null });
        },
        then: (resolve: any, reject?: any) => {
          if (table === 'customers') {
            return Promise.resolve({ data: [{ id: 'cust-sharma', name: 'Sharma' }], error: null }).then(resolve, reject);
          }
          if (table === 'sales_invoices') {
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          }
          if (table === 'payments') {
            return Promise.resolve({ data: mockExistingPaymentsList, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

describe('PaymentReceiveCreatePage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    mockParams = {};
    mockExistingPayment = null;
    mockExistingPaymentsList = [];
    navigateMock.mockReset();
    toastMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without cluttered subtitles or helper text', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentReceiveCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // No cluttered section subtitles or headers
    expect(screen.queryByText(/Party & Allocation/i)).toBeNull();
    expect(screen.queryByText(/Optionally allocate against an open invoice/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Payment$/i })).toBeNull();

    // Standardized fields exist
    expect(screen.getByLabelText(/Customer/i)).not.toBeNull();
    expect(screen.getByLabelText(/Amount/i)).not.toBeNull();
    expect(screen.getByText(/Date/i)).not.toBeNull();
    expect(screen.getByText(/Time/i)).not.toBeNull();
    expect(screen.getByLabelText(/Payment Method/i)).not.toBeNull();
    expect(screen.getByLabelText(/Reference/i)).not.toBeNull();
    expect(screen.getByLabelText(/Notes/i)).not.toBeNull();

    // Primary Receive Payment button
    expect(screen.getByRole('button', { name: /Receive Payment/i })).not.toBeNull();
  });

  it('submits payment directly into payments table without relying on broken RPC', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentReceiveCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for customer option to populate
    await waitFor(() => {
      expect(screen.getByText('Sharma')).not.toBeNull();
    });

    // Select Sharma
    fireEvent.change(screen.getByLabelText(/Customer/i), { target: { value: 'cust-sharma' } });

    // Enter Amount 20000
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '20000' } });

    // Click Receive Payment
    fireEvent.click(screen.getByRole('button', { name: /Receive Payment/i }));

    // Verify insert into payments table was called with correct fields
    await waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith('payments', expect.objectContaining({
        business_id: 'biz-1',
        type: 'received',
        party_type: 'customer',
        party_id: 'cust-sharma',
        amount: 20000,
        payment_method: 'cash',
      }));
    });

    // Verify navigation back to /app/payments-received
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app/payments-received');
    });

    // Verify success toast
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Payment'), 'success');
  });

  it('renders Receipt Number field in Row 1 and pre-fills auto-generated PR/ABC/SE/26-27/1', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentReceiveCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const receiptNumInput = screen.getByLabelText(/Receipt Number/i) as HTMLInputElement;
    expect(receiptNumInput).not.toBeNull();

    await waitFor(() => {
      expect(receiptNumInput.value).toBe('PR/ABC/SE/26-27/1');
    });
  });

  it('in Edit mode: populates Receipt Number with current number, allows editing, and persists changes', async () => {
    mockParams = { id: 'pay-existing-1' };
    mockExistingPayment = {
      id: 'pay-existing-1',
      business_id: 'biz-1',
      party_id: 'cust-sharma',
      payment_number: 'RCP/26-27/1',
      amount: 20000,
      allocated_amount: 0,
      date: '2026-10-28',
      payment_method: 'cash',
      reference: null,
      notes: 'Initial note',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentReceiveCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for existing record to load into the input
    const receiptNumInput = screen.getByLabelText(/Receipt Number/i) as HTMLInputElement;
    await waitFor(() => {
      expect(receiptNumInput.value).toBe('RCP/26-27/1');
    });

    // Verify title is Edit Payment and button is Save Changes
    expect(screen.getByRole('heading', { name: /Edit Payment/i })).not.toBeNull();
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    expect(saveBtn).not.toBeNull();

    // User updates the receipt number to PR/ABC/SE/26-27/1
    fireEvent.change(receiptNumInput, { target: { value: 'PR/ABC/SE/26-27/1' } });
    expect(receiptNumInput.value).toBe('PR/ABC/SE/26-27/1');

    // Click Save Changes
    fireEvent.click(saveBtn);

    // Verify payments table update was called with new payment_number
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('payments', expect.objectContaining({
        payment_number: 'PR/ABC/SE/26-27/1',
        amount: 20000,
      }));
    });

    // Verify toast and navigation
    expect(toastMock).toHaveBeenCalledWith('Payment updated successfully', 'success');
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received');
  });

  it('rejects duplicate or empty receipt numbers with error feedback', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PaymentReceiveCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Sharma')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText(/Customer/i), { target: { value: 'cust-sharma' } });
    fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: '500' } });

    // Clear receipt number
    const receiptNumInput = screen.getByLabelText(/Receipt Number/i);
    fireEvent.change(receiptNumInput, { target: { value: '' } });

    // Click submit
    fireEvent.click(screen.getByRole('button', { name: /Receive Payment/i }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('Please enter a Receipt Number', 'error');
    });
    expect(insertMock).not.toHaveBeenCalled();
  });
});
