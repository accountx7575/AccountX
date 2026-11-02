// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentReceivedViewPage } from './PaymentReceivedViewPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const mockBusiness = {
  id: 'biz-1',
  name: 'Avadh Boring Company',
  currency_symbol: '₹',
  bank_name: 'HDFC Bank',
  bank_account_no: '50100123456789',
  bank_ifsc: 'HDFC0001234',
  upi_id: 'avadh@upi',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: mockBusiness }),
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const printPaymentReceiptMock = vi.fn();
vi.mock('@/lib/receiptPrint', async () => {
  const actual = await vi.importActual('@/lib/receiptPrint');
  return {
    ...actual,
    printPaymentReceipt: (...args: any[]) => printPaymentReceiptMock(...args),
  };
});

const mockPayment = {
  id: 'pay-123',
  business_id: 'biz-1',
  party_id: 'cust-sharma',
  party_type: 'customer',
  payment_number: 'PR/ABC/SE/26-27/1',
  date: '2026-10-28',
  amount: 25000,
  allocated_amount: 20000,
  payment_method: 'bank',
  reference: 'UTR12345678',
  notes: 'Advance receipt',
  invoice_id: 'inv-1',
};

const mockCustomer = {
  id: 'cust-sharma',
  name: 'Sharma Traders',
  phone: '9876543210',
  email: 'sharma@example.com',
  address: 'Civil Lines, Barabanki',
  gstin: '09AABCS1429B1ZB',
};

const mockInvoice = {
  id: 'inv-1',
  invoice_number: 'INV/26-27/1',
  grand_total: 20000,
  balance_amount: 0,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          if (table === 'payments' || table === 'payments_received') {
            return Promise.resolve({ data: mockPayment, error: null });
          }
          if (table === 'customers') {
            return Promise.resolve({ data: mockCustomer, error: null });
          }
          if (table === 'sales_invoices') {
            return Promise.resolve({ data: mockInvoice, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  },
}));

describe('PaymentReceivedViewPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    navigateMock.mockReset();
    toastMock.mockReset();
    printPaymentReceiptMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders receipt details, header, status card, and center preview canvas', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/payments-received/pay-123']}>
          <Routes>
            <Route path="/app/payments-received/:id" element={<PaymentReceivedViewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify Title & Subtitle in PageHeader
    await waitFor(() => {
      expect(screen.getByText('Payment Receipt PR/ABC/SE/26-27/1')).not.toBeNull();
    });

    // Verify Action Buttons exist
    expect(screen.getByRole('button', { name: /Back/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Edit/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Print/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Download PDF/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /WhatsApp/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Email/i })).not.toBeNull();

    // Verify Status Banner
    expect(screen.getByText('Partially Applied')).not.toBeNull();
    expect(screen.getAllByText('₹25,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BANK').length).toBeGreaterThanOrEqual(1);

    // Verify Center Canvas content
    expect(screen.getAllByText('PAYMENT RECEIPT').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Sharma Traders').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Receipt Date & Time:/i)).not.toBeNull();
  });

  it('navigates to list on Back click and edit view on Edit click', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/payments-received/pay-123']}>
          <Routes>
            <Route path="/app/payments-received/:id" element={<PaymentReceivedViewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Payment Receipt PR/ABC/SE/26-27/1')).not.toBeNull();
    });

    // Test Back
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received');

    // Test Edit
    fireEvent.click(screen.getByRole('button', { name: /Edit/i }));
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-received/pay-123/edit');
  });

  it('triggers print receipt when Print is clicked and guards against rapid double clicks', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/payments-received/pay-123']}>
          <Routes>
            <Route path="/app/payments-received/:id" element={<PaymentReceivedViewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Payment Receipt PR/ABC/SE/26-27/1')).not.toBeNull();
    });

    const printBtn = screen.getByRole('button', { name: /Print/i });
    // Click twice rapidly
    fireEvent.click(printBtn);
    fireEvent.click(printBtn);

    expect(printPaymentReceiptMock).toHaveBeenCalledTimes(1);
    expect(printPaymentReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'pay-123',
        payment_number: 'PR/ABC/SE/26-27/1',
      }),
      expect.objectContaining(mockBusiness)
    );
  });
});
