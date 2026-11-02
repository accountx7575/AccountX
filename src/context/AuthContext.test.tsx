// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

const businessRows: any[] = [];
const sessionUser: any = {
  id: 'super-1',
  email: 'admin@accountx.test',
  app_metadata: { is_super_admin: true },
  user_metadata: {},
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const row = table === 'businesses' ? businessRows[0] : null;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: row ?? null, error: null }),
        single: async () => (row ? { data: row, error: null } : { data: null, error: null }),
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve, reject),
      };
      return chain;
    },
    auth: {
      getSession: async () => ({ data: { session: { user: sessionUser } } }),
      getUser: async () => ({ data: { user: sessionUser } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

import { AuthProvider, useAuth } from '@/context/AuthContext';

function Probe() {
  const { activeBusiness, activeRole, impersonatingBusinessId } = useAuth();
  return (
    <div>
      <span data-testid="active-name">{activeBusiness?.name ?? 'none'}</span>
      <span data-testid="active-role">{activeRole ?? 'none'}</span>
      <span data-testid="impersonating">{impersonatingBusinessId ?? 'none'}</span>
    </div>
  );
}

describe('AuthContext — Super Admin Support Mode resolves the impersonated tenant', () => {
  beforeEach(() => {
    localStorage.clear();
    businessRows.length = 0;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('activates the impersonated business when the impersonation id key is set', async () => {
    businessRows.push({ id: 'tenant-1', name: 'Krishnav Agro' });
    localStorage.setItem('accountx_impersonating_business_id', 'tenant-1');
    localStorage.setItem('super_admin_impersonating', 'true');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active-name').textContent).toBe('Krishnav Agro'));
    expect(screen.getByTestId('active-role').textContent).toBe('super-admin');
    expect(screen.getByTestId('impersonating').textContent).toBe('tenant-1');
  });

  it('activates the impersonated business from the legacy active-business key', async () => {
    businessRows.push({ id: 'tenant-2', name: 'Krishnav Agro' });
    localStorage.setItem('super_admin_impersonating', 'true');
    localStorage.setItem('accountx_active_business_id', 'tenant-2');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active-name').textContent).toBe('Krishnav Agro'));
    expect(screen.getByTestId('active-role').textContent).toBe('super-admin');
    expect(screen.getByTestId('impersonating').textContent).toBe('tenant-2');
  });

  it('falls back to membership when no impersonation is active', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active-name').textContent).toBe('none'));
    expect(screen.getByTestId('active-role').textContent).toBe('none');
  });
});

// user_metadata is self-service: any signed-in user can write
// is_super_admin into it with auth.updateUser({ data: ... }). The server gate
// public.is_super_admin() reads app_metadata only, so the client must agree.
describe('AuthContext — the client super-admin check is not spoofable', () => {
  beforeEach(() => {
    localStorage.clear();
    businessRows.length = 0;
    sessionUser.app_metadata = {};
    sessionUser.user_metadata = {};
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionUser.app_metadata = { is_super_admin: true };
    sessionUser.user_metadata = {};
  });

  it('ignores a user_metadata-only super admin: no impersonation and the flag is scrubbed', async () => {
    sessionUser.user_metadata = { is_super_admin: true };
    businessRows.push({ id: 'tenant-3', name: 'Krishnav Agro' });
    localStorage.setItem('super_admin_impersonating', 'true');
    localStorage.setItem('accountx_active_business_id', 'tenant-3');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active-name').textContent).toBe('none'));
    expect(screen.getByTestId('active-role').textContent).toBe('none');
    expect(screen.getByTestId('impersonating').textContent).toBe('none');
    expect(localStorage.getItem('super_admin_impersonating')).toBeNull();
  });

  it('honours an app_metadata super admin: the impersonated tenant is activated', async () => {
    sessionUser.app_metadata = { is_super_admin: true };
    businessRows.push({ id: 'tenant-4', name: 'Krishnav Agro' });
    localStorage.setItem('super_admin_impersonating', 'true');
    localStorage.setItem('accountx_active_business_id', 'tenant-4');

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('active-name').textContent).toBe('Krishnav Agro'));
    expect(screen.getByTestId('active-role').textContent).toBe('super-admin');
    expect(screen.getByTestId('impersonating').textContent).toBe('tenant-4');
  });
});
