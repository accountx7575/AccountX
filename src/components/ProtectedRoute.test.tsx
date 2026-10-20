// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const authState: any = vi.hoisted(() => ({
  session: null,
  loading: false,
  businessesReady: false,
  businesses: [],
  user: null,
  activeBusiness: null,
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: () => authState }));

describe('ProtectedRoute — /login anchor (N1)', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    authState.session = null;
    authState.businesses = [];
    authState.user = null;
    authState.businessesReady = false;
  });

  it('unauthenticated visit to a guarded route lands on the /login destination', () => {
    render(
      <MemoryRouter initialEntries={['/app/customers']}>
        <Routes>
          <Route path="/app/customers" element={<ProtectedRoute><div>guarded children</div></ProtectedRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/setup-business" element={<div>setup destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('guarded children')).toBeNull();
    expect(screen.getByText('login destination element')).toBeTruthy();
  });

  it('session without any business still reaches the guard children only for the setup-business path', () => {
    authState.session = { access_token: 'x' };
    authState.businessesReady = true;
    render(
      <MemoryRouter initialEntries={['/app/customers']}>
        <Routes>
          <Route path="/app/customers" element={<ProtectedRoute><div>guarded children</div></ProtectedRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/setup-business" element={<div>setup destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByText('guarded children')).toBeNull();
    expect(screen.getByText('setup destination element')).toBeTruthy();
  });

  it('authenticated session with a business renders the guard children', () => {
    authState.session = { access_token: 'x' };
    authState.businessesReady = true;
    authState.businesses = [{ id: 'b1' }];
    render(
      <MemoryRouter initialEntries={['/app/customers']}>
        <Routes>
          <Route path="/app/customers" element={<ProtectedRoute><div>guarded children</div></ProtectedRoute>} />
          <Route path="/login" element={<div>login destination element</div>} />
          <Route path="/setup-business" element={<div>setup destination element</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('guarded children')).toBeTruthy();
    expect(screen.queryByText('login destination element')).toBeNull();
  });
});
