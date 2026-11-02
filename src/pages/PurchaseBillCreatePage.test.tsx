// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseBillCreatePage } from './PurchaseBillCreatePage';

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
  purchase_bill_prefix: 'BILL/ABC/SE',
  financial_year: '2026-27',
  state: 'Uttar Pradesh',
};
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ activeBusiness: mockBusiness }),
}));

const toastMock = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const rpcMock = vi.fn();
const mockSuppliers = [
  { id: '14c1652a-9a48-441b-be9d-6c9da6e11a95', name: 'Alpha Traders', state: 'Uttar Pradesh', status: 'active' },
];
const mockProducts = [
  { id: 'ede3cbe7-cb34-48a2-893b-447e4a2b9038', name: 'Submersible Pump', purchase_price: 1000, current_stock: 10, is_active: true, unit: 'PCS', tax_rate: 18 },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        update: () => builder,
        delete: () => builder,
        insert: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        single: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: any) => {
          if (table === 'suppliers') {
            return resolve({ data: mockSuppliers, error: null });
          }
          if (table === 'products') {
            return resolve({ data: mockProducts, error: null });
          }
          if (table === 'purchase_bills') {
            return resolve({ data: [], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

describe('PurchaseBillCreatePage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockParams = {};
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    rpcMock.mockImplementation((rpcName: string) => {
      if (rpcName === 'next_document_number') {
        return Promise.resolve({ data: 'BILL/26-27/1', error: null });
      }
      if (rpcName === 'create_purchase_bill') {
        return Promise.resolve({ data: [{ bill_id: 'bill-123' }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders New Purchase Bill header and form', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PurchaseBillCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('New Purchase Bill')).toBeTruthy();
    expect(screen.getByText('Confirm Purchase')).toBeTruthy();
  });

  it('sanitizes UUIDs and successfully confirms purchase bill', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PurchaseBillCreatePage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for suppliers & products to load
    await waitFor(() => {
      expect(screen.getByText('Alpha Traders')).toBeTruthy();
      expect(screen.getByText(/Submersible Pump/)).toBeTruthy();
    });

    // Select supplier
    const comboboxes = screen.getAllByRole('combobox');
    const supplierSelect = comboboxes[0];
    fireEvent.change(supplierSelect, { target: { value: '14c1652a-9a48-441b-be9d-6c9da6e11a95' } });

    // Select product in row 1
    const productSelect = comboboxes[1];
    fireEvent.change(productSelect, { target: { value: 'ede3cbe7-cb34-48a2-893b-447e4a2b9038' } });

    // Click confirm purchase
    const confirmButton = screen.getByRole('button', { name: /Confirm Purchase/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('create_purchase_bill', expect.any(Object));
    });

    const callArgs = rpcMock.mock.calls.find((call) => call[0] === 'create_purchase_bill');
    expect(callArgs).toBeDefined();
    const params = callArgs![1];

    expect(params.p_bill.supplier_id).toBe('14c1652a-9a48-441b-be9d-6c9da6e11a95');
    expect(params.p_bill.bank_account_id).toBeUndefined();
    expect(params.p_bill.warehouse_id).toBeUndefined();
    expect(params.p_status).toBe('confirmed');

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/app/purchase-bills');
    });
  });
});
