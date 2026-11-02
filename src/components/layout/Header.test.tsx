// @vitest-environment jsdom
/**
 * PBS-173: the two "+ Add New Business" entry points in Header (the business
 * switcher dropdown and the user menu) must do NOTHING except close the
 * dropdown and navigate to the create form — no insert, no RPC, no side
 * effect against the businesses table. The tenant row itself is only ever
 * created by the explicit submit on /setup-business (BusinessSetupPage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const navigateMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('framer-motion', () => {
  const passthrough = (_props: any) => _props.children;
  return { motion: { div: passthrough }, AnimatePresence: passthrough, useReducedMotion: () => true };
});

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: any[]) => {
      fromMock(...args);
      return { select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), rpc: vi.fn() };
    },
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'owner@example.com' },
    businesses: [{ id: 'b1', name: 'Sharma Traders', city: 'Kanpur', state: 'Uttar Pradesh', gst_registered: true }],
    activeBusiness: { id: 'b1', name: 'Sharma Traders', gst_registered: true },
    activeRole: 'owner',
    setActiveBusiness: vi.fn(),
    signOut: vi.fn(),
    refreshBusinesses: vi.fn(),
  }),
}));

vi.mock('@/context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }) }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock('@/components/layout/UserProfileModal', () => ({ UserProfileModal: () => null }));
vi.mock('@/components/layout/NotificationsDropdown', () => ({ AlertsDropdown: () => null }));
vi.mock('@/components/layout/HelpDropdown', () => ({ HelpDropdown: () => null }));
vi.mock('@/components/layout/ReportIssueModal', () => ({ ReportIssueModal: () => null }));
vi.mock('@/components/common/PromoBadge', () => ({ PromoBadge: () => null }));

import { Header } from './Header';

describe('Header — "+ Add New Business" opens only the create form', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts with zero businesses-table traffic', () => {
    render(<Header onMobileMenu={vi.fn()} onQuickAction={vi.fn()} />);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('the switcher entry navigates to /setup-business and touches nothing else', () => {
    render(<Header onMobileMenu={vi.fn()} onQuickAction={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Sharma Traders'));
    fireEvent.click(screen.getByRole('button', { name: /Add New Business/i }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/setup-business');
    // dropdown closed after the click
    expect(screen.queryByRole('button', { name: /Add New Business/i })).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('the user-menu "Add Business" entry navigates too, with no insert path anywhere', () => {
    render(<Header onMobileMenu={vi.fn()} onQuickAction={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Account menu'));
    fireEvent.click(screen.getByRole('button', { name: /Add Business/i }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/setup-business');
    expect(screen.queryByRole('button', { name: /Add Business/i })).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
