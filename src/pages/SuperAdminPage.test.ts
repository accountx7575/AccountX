import { describe, it, expect } from 'vitest';
import {
  applyImpersonationKeys,
  runImpersonation,
  IMPERSONATION_STORAGE_KEYS,
  formatRecentInvoiceNumbers,
  formatInrVolume,
} from '@/pages/SuperAdminPage';

type StorageCall = { op: 'set' | 'remove' | 'clear'; key: string; value?: string };

function makeStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const calls: StorageCall[] = [];
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      calls.push({ op: 'set', key, value });
      store.set(key, value);
    },
    removeItem: (key: string) => {
      calls.push({ op: 'remove', key });
      store.delete(key);
    },
    clear: () => {
      calls.push({ op: 'clear', key: '*' });
      store.clear();
    },
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return { storage, calls, store };
}

describe('PBS-161 — tenant switch clears the previous tenant and pins the new one', () => {
  it('removes the previous tenant keys BEFORE writing the new ones', () => {
    const { storage, calls, store } = makeStorage({
      accountx_active_business_id: 'tenant-a',
      accountx_impersonating_business_id: 'tenant-a',
      impersonated_tenant_id: 'tenant-a',
      accountx_impersonation_notice_seen: 'yes', // unrelated app state
    });

    applyImpersonationKeys('tenant-b', storage);

    const removals = calls.filter((c) => c.op === 'remove').map((c) => c.key);
    expect(removals).toEqual([
      IMPERSONATION_STORAGE_KEYS.activeBusiness,
      IMPERSONATION_STORAGE_KEYS.impersonatingBusiness,
      IMPERSONATION_STORAGE_KEYS.tenant,
    ]);
    // Every removal happens before the first write.
    const firstSet = calls.findIndex((c) => c.op === 'set');
    const lastRemove = calls.map((c) => c.op).lastIndexOf('remove');
    expect(lastRemove).toBeLessThan(firstSet);

    // The new tenant owns every key now.
    expect(store.get('accountx_active_business_id')).toBe('tenant-b');
    expect(store.get('accountx_impersonating_business_id')).toBe('tenant-b');
    expect(store.get('impersonated_tenant_id')).toBe('tenant-b');
    expect(store.get('super_admin_impersonating')).toBe('true');
    expect(store.get('accountx_impersonating')).toBe('true');

    // The previous tenant is gone and unrelated state survived.
    expect(Array.from(store.values())).not.toContain('tenant-a');
    expect(store.get('accountx_impersonation_notice_seen')).toBe('yes');
    // The whole storage is never wiped.
    expect(calls.some((c) => c.op === 'clear')).toBe(false);
  });

  it('re-resolves the tenant context before navigating (a soft navigate alone was the bug)', async () => {
    const { storage, store } = makeStorage({ accountx_active_business_id: 'tenant-a' });
    const order: string[] = [];

    const outcome = await runImpersonation({
      tenantId: 'tenant-b',
      storage,
      refresh: async () => {
        order.push('refresh');
        // The re-resolution reads the key that was just written.
        expect(store.get('accountx_impersonating_business_id')).toBe('tenant-b');
      },
      softNavigate: (url) => order.push(`soft:${url}`),
      hardNavigate: (url) => order.push(`hard:${url}`),
    });

    expect(outcome).toBe('soft');
    expect(order).toEqual(['refresh', 'soft:/app?mode=impersonation']);
  });

  it('falls back to a hard reload when the context cannot be re-resolved', async () => {
    const { storage } = makeStorage();
    const order: string[] = [];

    const outcome = await runImpersonation({
      tenantId: 'tenant-b',
      storage,
      refresh: async () => { throw new Error('auth context unavailable'); },
      softNavigate: (url) => order.push(`soft:${url}`),
      hardNavigate: (url) => order.push(`hard:${url}`),
    });

    expect(outcome).toBe('hard');
    expect(order).toEqual(['hard:/app?mode=impersonation']);
  });
});

describe('PBS-161 — tenant invoice metrics formatting', () => {
  it('shows at most five recent document numbers and counts the rest', () => {
    expect(formatRecentInvoiceNumbers('SO/26-27/3, SO/26-27/2, SO/26-27/1')).toBe('SO/26-27/3, SO/26-27/2, SO/26-27/1');
    expect(formatRecentInvoiceNumbers('1,2,3,4,5,6,7')).toBe('1, 2, 3, 4, 5 +2 more');
    expect(formatRecentInvoiceNumbers(null)).toBe('');
    expect(formatRecentInvoiceNumbers('')).toBe('');
  });

  it('formats the billed volume in Indian grouping and never fakes a zero', () => {
    expect(formatInrVolume(453000)).toBe('4,53,000');
    expect(formatInrVolume(0)).toBe('0');
    expect(formatInrVolume(null)).toBe('—');
    expect(formatInrVolume(undefined)).toBe('—');
  });
});
