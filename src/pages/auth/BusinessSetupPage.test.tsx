// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const rpcMock = vi.fn();
const toastMock = vi.fn();
const refreshBusinessesMock = vi.fn();
const setActiveBusinessMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    refreshBusinesses: refreshBusinessesMock,
    setActiveBusiness: setActiveBusinessMock,
    businesses: [],
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { BusinessSetupPage } from '@/pages/auth/BusinessSetupPage';

const nameInput = () => screen.getByPlaceholderText('ABC Traders') as HTMLInputElement;
const submitButton = () => screen.getByRole('button', { name: /Create Business & Get Started/i });

describe('BusinessSetupPage — a tenant row is only created by an explicit, named submit', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    toastMock.mockReset();
    refreshBusinessesMock.mockReset();
    setActiveBusinessMock.mockReset();
    rpcMock.mockResolvedValue({ data: 'biz-1', error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates nothing on mount', async () => {
    render(<BusinessSetupPage />);
    await waitFor(() => expect(screen.getByText(/Set Up Your Business/i)).toBeTruthy());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('creates nothing when the business name is empty', async () => {
    render(<BusinessSetupPage />);
    expect(nameInput().validity.valueMissing).toBe(true);
    fireEvent.click(submitButton());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('creates nothing when the business name is only whitespace', async () => {
    render(<BusinessSetupPage />);
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('creates nothing for an auto-generated dummy name', async () => {
    render(<BusinessSetupPage />);
    fireEvent.change(nameInput(), { target: { value: 'asdf' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('creates exactly one tenant, with the trimmed name, on explicit submit', async () => {
    render(<BusinessSetupPage />);
    fireEvent.change(nameInput(), { target: { value: '  Sharma Traders  ' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock.mock.calls[0][0]).toBe('create_business_with_owner');
    expect(rpcMock.mock.calls[0][1].p_name).toBe('Sharma Traders');
  });
});
