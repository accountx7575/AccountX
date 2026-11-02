// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomerCreatePage } from './CustomerCreatePage';
import { supabase } from '@/lib/supabase';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    activeBusiness: {
      id: 'biz-123',
      name: 'Avadh Boring Company',
      currency_symbol: '₹',
    },
  }),
}));

const mockToast = vi.fn();
vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('CustomerCreatePage with Aadhaar', () => {
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

  it('renders Aadhaar Number input field alongside GSTIN and PAN', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/customers/new']}>
          <Routes>
            <Route path="/app/customers/new" element={<CustomerCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByLabelText('GSTIN')).not.toBeNull();
    expect(screen.getByLabelText('PAN')).not.toBeNull();
    const aadhaarInput = screen.getByLabelText(/Aadhaar Number/i);
    expect(aadhaarInput).not.toBeNull();
    expect(aadhaarInput.getAttribute('placeholder')).toContain('XXXX XXXX XXXX');
  });

  it('masks Aadhaar input with spaces as 4-4-4 format as user types', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/customers/new']}>
          <Routes>
            <Route path="/app/customers/new" element={<CustomerCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const aadhaarInput = screen.getByLabelText(/Aadhaar Number/i) as HTMLInputElement;
    fireEvent.change(aadhaarInput, { target: { value: '123456789012' } });

    expect(aadhaarInput.value).toBe('1234 5678 9012');
  });

  it('shows error if Aadhaar number is entered with less than 12 digits', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/customers/new']}>
          <Routes>
            <Route path="/app/customers/new" element={<CustomerCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const nameInput = screen.getByLabelText(/Customer Name \*/i);
    fireEvent.change(nameInput, { target: { value: 'Sunil Kumar' } });

    const aadhaarInput = screen.getByLabelText(/Aadhaar Number/i);
    fireEvent.change(aadhaarInput, { target: { value: '12345' } });

    const submitBtn = screen.getByRole('button', { name: /Save Customer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringContaining('Invalid Aadhaar Number'),
        'error'
      );
    });
  });

  it('submits successfully with clean 12-digit Aadhaar payload', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(supabase, 'from').mockReturnValue({
      insert: mockInsert,
    } as any);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/customers/new']}>
          <Routes>
            <Route path="/app/customers/new" element={<CustomerCreatePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const nameInput = screen.getByLabelText(/Customer Name \*/i);
    fireEvent.change(nameInput, { target: { value: 'Sunil Kumar' } });

    const aadhaarInput = screen.getByLabelText(/Aadhaar Number/i);
    fireEvent.change(aadhaarInput, { target: { value: '987654321098' } });

    const submitBtn = screen.getByRole('button', { name: /Save Customer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sunil Kumar',
          aadhaar: '987654321098',
        })
      );
    });
  });
});
