import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearBroadcastBanners,
  deleteBroadcastBanner,
  dismissBroadcast,
  getActiveBroadcastBanner,
  listBroadcastBanners,
  setBroadcastActive,
  setBroadcastBanner,
} from '@/lib/broadcastStore';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
  clearBroadcastBanners();
});

describe('broadcastStore — banner composer state', () => {
  it('publishes an active info banner', () => {
    const banner = setBroadcastBanner({ message: 'Scheduled maintenance on Sunday', type: 'info' });
    expect(banner.active).toBe(true);
    expect(banner.type).toBe('info');
    expect(getActiveBroadcastBanner()!.message).toBe('Scheduled maintenance on Sunday');
  });

  it('deactivates the previous banner when a new one is published', () => {
    setBroadcastBanner({ message: 'First banner message', type: 'info' });
    setBroadcastBanner({ message: 'Second banner message', type: 'warn' });
    const list = listBroadcastBanners();
    expect(list).toHaveLength(2);
    expect(list.filter((b) => b.active)).toHaveLength(1);
    expect(getActiveBroadcastBanner()!.message).toBe('Second banner message');
  });

  it('toggles the active flag', () => {
    const banner = setBroadcastBanner({ message: 'Toggle this banner message', type: 'warn' });
    setBroadcastActive(banner.id, false);
    expect(getActiveBroadcastBanner()).toBeNull();
    setBroadcastActive(banner.id, true);
    expect(getActiveBroadcastBanner()!.id).toBe(banner.id);
  });

  it('deletes a banner', () => {
    const banner = setBroadcastBanner({ message: 'Delete me banner message', type: 'info' });
    deleteBroadcastBanner(banner.id);
    expect(listBroadcastBanners()).toHaveLength(0);
  });

  it('hides a dismissed banner for the session', () => {
    const banner = setBroadcastBanner({ message: 'Dismiss me banner message', type: 'info' });
    dismissBroadcast(banner.id);
    expect(getActiveBroadcastBanner()).toBeNull();
  });
});
