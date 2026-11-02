// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const logAdminEvent = vi.hoisted(() => vi.fn());
const refreshBusinesses = vi.hoisted(() => vi.fn(async () => {}));
const authState = vi.hoisted(() => ({
  user: null as any,
  activeBusiness: null as any,
  refreshBusinesses,
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({ logAdminEvent }),
}));
vi.mock('@/hooks/usePlatformAnnouncement', () => ({
  usePlatformAnnouncement: () => ({ announcement: null, dismiss: vi.fn() }),
}));
vi.mock('./Sidebar', () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock('./Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('./BroadcastBanner', () => ({ BroadcastBanner: () => <div data-testid="banner" /> }));
vi.mock('@/components/QuickActions', () => ({ QuickActions: () => null }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
  },
}));

import { AppLayout } from '@/components/layout/AppLayout';

const IMPERSONATION_KEYS = [
  'super_admin_impersonating',
  'accountx_impersonating',
  'impersonated_tenant_id',
  'accountx_impersonating_business_id',
  'accountx_active_business_id',
];

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<AppLayout />} />
        <Route
          path="/super-admin"
          element={<div data-testid="super-admin-page">control centre</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout — exit to admin control centre', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    logAdminEvent.mockClear();
    refreshBusinesses.mockClear();
    authState.user = { id: 'admin-1', app_metadata: { is_super_admin: true } };
    authState.activeBusiness = { id: 'tenant-9', name: 'Krishnav Agro' };
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('clears every impersonation key, re-resolves the context and routes to /super-admin', async () => {
    localStorage.setItem('super_admin_impersonating', 'true');
    localStorage.setItem('accountx_impersonating', 'true');
    localStorage.setItem('impersonated_tenant_id', 'tenant-9');
    localStorage.setItem('accountx_impersonating_business_id', 'tenant-9');
    localStorage.setItem('accountx_active_business_id', 'tenant-9');
    sessionStorage.setItem('accountx_impersonation_notice_seen', '1');

    renderApp();

    const exitButton = await screen.findByRole('button', {
      name: /exit to admin control center/i,
    });

    await act(async () => {
      fireEvent.click(exitButton);
    });

    // The pinned active business and all four impersonation keys are gone.
    for (const key of IMPERSONATION_KEYS) {
      expect(localStorage.getItem(key), `${key} must be cleared on exit`).toBeNull();
    }
    // The impersonation notice flag is cleared as well.
    expect(sessionStorage.getItem('accountx_impersonation_notice_seen')).toBeNull();
    // The auth context is re-resolved so activeBusiness can fall back to the
    // admin's own membership business instead of the impersonated tenant.
    expect(refreshBusinesses).toHaveBeenCalledTimes(1);
    // The router went to the control centre.
    await waitFor(() => expect(screen.getByTestId('super-admin-page')).toBeTruthy());
  });

  it('audits IMPERSONATION_END with the tenant id captured before the keys are cleared', async () => {
    localStorage.setItem('super_admin_impersonating', 'true');
    localStorage.setItem('impersonated_tenant_id', 'tenant-9');
    localStorage.setItem('accountx_active_business_id', 'tenant-9');

    renderApp();

    const exitButton = await screen.findByRole('button', {
      name: /exit to admin control center/i,
    });

    await act(async () => {
      fireEvent.click(exitButton);
    });

    const endEvent = logAdminEvent.mock.calls.find((call) => call[0] === 'IMPERSONATION_END');
    expect(endEvent, 'IMPERSONATION_END must be logged').toBeTruthy();
    expect(endEvent?.[1]).toBe('tenant-9');
  });
});
