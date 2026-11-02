/**
 * Broadcast banner store shim (PBS-141).
 *
 * The Super Admin broadcast composer writes here; AppLayout renders the
 * active banner site-wide through the existing layout. localStorage-backed
 * (`ax-broadcast-banner-v1`), service-swappable like the other PBS-141
 * shims. The existing platform_announcements channel is intentionally left
 * untouched this turn so tenants never see duplicate banners.
 */

export type BroadcastType = 'info' | 'warn';

export interface BroadcastBanner {
  id: string;
  message: string;
  type: BroadcastType;
  active: boolean;
  createdAt: string;
}

const STORAGE_KEY = 'ax-broadcast-banner-v1';
const CHANGE_EVENT = 'ax-broadcast-banner-changed';
const DISMISS_PREFIX = 'ax-dismissed-broadcast-';

export const BROADCAST_CHANGE_EVENT = CHANGE_EVENT;
export const BROADCAST_STORAGE_KEY = STORAGE_KEY;
export const BROADCAST_DISMISS_PREFIX = DISMISS_PREFIX;

function readAll(): BroadcastBanner[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BroadcastBanner[]) : [];
  } catch {
    return [];
  }
}

function writeAll(banners: BroadcastBanner[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(banners));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch {
    /* storage full/unavailable — banner stays in-memory for the session */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The banner users should currently see (active; not dismissed this session). */
export function getActiveBroadcastBanner(): BroadcastBanner | null {
  const active = readAll().filter((b) => b.active);
  if (active.length === 0) return null;
  const latest = active[0];
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_PREFIX + latest.id)) {
      return null;
    }
  } catch {
    /* sessionStorage may be unavailable — still show */
  }
  return latest;
}

export function listBroadcastBanners(): BroadcastBanner[] {
  return readAll().sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export interface BroadcastDraft {
  message: string;
  type: BroadcastType;
}

/** Publishes a new banner; previously active banners are deactivated. */
export function setBroadcastBanner(draft: BroadcastDraft): BroadcastBanner {
  const now = new Date().toISOString();
  const banner: BroadcastBanner = {
    id: uid(),
    message: draft.message.trim(),
    type: draft.type,
    active: true,
    createdAt: now,
  };
  writeAll(readAll().map((b) => ({ ...b, active: false })).concat([banner]));
  return banner;
}

export function setBroadcastActive(id: string, active: boolean): void {
  writeAll(readAll().map((b) => (b.id === id ? { ...b, active } : b)));
}

export function deleteBroadcastBanner(id: string): void {
  writeAll(readAll().filter((b) => b.id !== id));
}

export function clearBroadcastBanners(): void {
  writeAll([]);
}

/** Per-session dismissal (returns on reload/new session, like announcements). */
export function dismissBroadcast(id: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DISMISS_PREFIX + id, '1');
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch {
    /* ignore */
  }
}
