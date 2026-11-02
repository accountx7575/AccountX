// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SuperAdminRoute } from '@/components/auth/SuperAdminRoute';

const authState: any = vi.hoisted(() => ({
  session: null as any,
  user: null as any,
  loading: false,
}));
const toastMock = vi.fn();

vi.mock('@/context/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('@/context/ToastContext', () => ({ useToast: () => ({ toast: toastMock }) }));

// PBS-140 gate: hard super_admin check with /app bounce for regular users.
describe('SuperAdminRoute — role gate (N1)', () => {
  afterEach(() => {
    cleanup();
    toastMock.mockClear();
  });

  beforeEach(() => {
    authState.session = null;
    authState.user = null;
    authState.loading = false;
  });

  it('unauthenticated visit lands on /login', () => {
    render(
      <MemoryRouter initialEntries={['/super-admin/users']}>
        <Routes>
          <Route path="/super-admin/users" element={<SuperAdminRoute><div>super children</div></SuperAdminRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/app" element={<div>tenant destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('super children')).toBeNull();
    expect(screen.getByText('login destination element')).toBeTruthy();
  });

  it('session without super admin flag redirects to /app, never renders children', () => {
    authState.session = { access_token: 'x' };
    authState.user = { id: 'u1', email: 'human@example.com' };
    render(
      <MemoryRouter initialEntries={['/super-admin/users']}>
        <Routes>
          <Route path="/super-admin/users" element={<SuperAdminRoute><div>super children</div></SuperAdminRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/app" element={<div>tenant destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('super children')).toBeNull();
    expect(screen.getByText('tenant destination element')).toBeTruthy();
    expect(toastMock).toHaveBeenCalledWith('Super admin access required', 'error');
  });

  it('super admin metadata renders the guard children', () => {
    authState.session = { access_token: 'x' };
    authState.user = { id: 'u1', app_metadata: { is_super_admin: true } };
    render(
      <MemoryRouter initialEntries={['/super-admin/users']}>
        <Routes>
          <Route path="/super-admin/users" element={<SuperAdminRoute><div>super children</div></SuperAdminRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/app" element={<div>tenant destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('super children')).toBeTruthy();
    expect(screen.queryByText('tenant destination element')).toBeNull();
  });
});
