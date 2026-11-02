// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentMadeViewPage } from '@/pages/PaymentMadeViewPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const mockBusiness = { id: 'biz-1', currency_symbol: '₹', name: 'Avadh Boring Company' };
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: mockBusiness }),
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const printPaymentVoucherMock = vi.fn();
vi.mock('@/lib/receiptPrint', async () => {
  const actual: any = await vi.importActual('@/lib/receiptPrint');
  return {
    ...actual,
    printPaymentVoucher: (...args: any[]) => printPaymentVoucherMock(...args),
  };
});

const mockPayment = {
  id: 'pay-made-1',
  business_id: 'biz-1',
  type: 'made',
  party_type: 'supplier',
  party_id: 'supp-tata',
  payment_number: 'PAY/26-27/1',
  date: '2026-10-28',
  payment_date: '2026-10-28',
  time: '04:30 PM',
  amount: 25000,
  allocated_amount: 25000,
  payment_method: 'bank',
  reference: 'UTR112233',
  notes: 'Supplier payment for solar materials',
  bill_id: 'bill-1',
  created_at: '2026-10-28T10:00:00Z',
};

const mockSupplier = {
  id: 'supp-tata',
  name: 'Tata Power Solar Systems',
  email: 'solar@tatapower.com',
  phone: '9876543210',
  address: 'Plot 45, Industrial Area',
  city: 'Lucknow',
  state: 'Uttar Pradesh',
  pincode: '226001',
  gstin: '09AAACT2727Q1ZT',
  pan: 'AAACT2727Q',
};

const mockBill = {
  id: 'bill-1',
  bill_number: 'PB/26-27/045',
  grand_total: 25000,
  balance_amount: 0,
  supplier_id: 'supp-tata',
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: (cols?: string) => builder,
        eq: (col: string, val: any) => builder,
        maybeSingle: () => {
          if (table === 'payments' || table === 'payments_made') {
            return Promise.resolve({ data: mockPayment, error: null });
          }
          if (table === 'suppliers') {
            return Promise.resolve({ data: mockSupplier, error: null });
          }
          if (table === 'purchase_bills') {
            return Promise.resolve({ data: mockBill, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  },
}));

describe('PaymentMadeViewPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    navigateMock.mockReset();
    toastMock.mockReset();
    printPaymentVoucherMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders payment voucher details and party information', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/payments-made/pay-made-1']}>
          <Routes>
            <Route path="/app/payments-made/:id" element={<PaymentMadeViewPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Verify header title
    await waitFor(() => {
      expect(screen.getByText('Payment Voucher PAY/26-27/1')).not.toBeNull();
    });

    // Verify supplier name in page
    const supplierElements = screen.getAllByText(/Tata Power Solar Systems/i);
    expect(supplierElements.length).toBeGreaterThanOrEqual(1);

    // Verify amount paid
    const amountElements = screen.getAllByText('₹25,000.00');
    expect(amountElements.length).toBeGreaterThanOrEqual(1);

    // Verify back and edit buttons
    const backBtn = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-made');

    const editBtn = screen.getByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);
    expect(navigateMock).toHaveBeenCalledWith('/app/payments-made/pay-made-1/edit');

    // Verify print button
    const printBtn = screen.getByRole('button', { name: /Print/i });
    fireEvent.click(printBtn);
    expect(printPaymentVoucherMock).toHaveBeenCalledTimes(1);
  });
});
