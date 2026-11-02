/* ============================================================================
 * Business extras resilience (schemafix-1002, reworked by PBS-149).
 *
 * HISTORY: the save path used to strip pincode / upi_qr_url / account_name
 * before the PATCH (they were believed to be missing server-side) and stash
 * them in localStorage. That was STALE: all three columns DO exist in
 * public.businesses, so the PIN code, the UPI QR and the account name never
 * reached the database - the UI only looked right because the render path
 * overlaid the local stash.
 *
 * NOW: the strip set is derived from the discovered column set
 * (src/lib/businessSchema.ts -> discoverBusinessColumns). A column that exists
 * is always sent; only genuinely missing columns are stashed. This module
 * keeps the legacy stash so old local copies can still be displayed, and
 * clears the entries once the value is persisted server-side.
 * ==========================================================================*/

export interface BusinessExtras {
  pincode?: string | null;
  upi_qr_url?: string | null;
  account_name?: string | null;
}

/**
 * Legacy stash keys. These columns EXIST in public.businesses today - the list
 * is only used to clean up local copies written before PBS-149, never to strip
 * a column from a save.
 */
export const DRIFTED_EXTRAS_KEYS = ['pincode', 'upi_qr_url', 'account_name'] as const;

export type DriftedExtrasKey = (typeof DRIFTED_EXTRAS_KEYS)[number];

const stashKey = (businessId: string): string => `ax-business-extras:${businessId}`;

export function readBusinessExtras(businessId: string): BusinessExtras {
  try {
    const raw = localStorage.getItem(stashKey(businessId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: BusinessExtras = {};
    for (const k of DRIFTED_EXTRAS_KEYS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function stashBusinessExtras(businessId: string, extras: BusinessExtras): void {
  try {
    const prev = readBusinessExtras(businessId);
    localStorage.setItem(stashKey(businessId), JSON.stringify({ ...prev, ...extras }));
  } catch {
    /* storage unavailable — extras just won't persist */
  }
}

/**
 * Drop legacy stash entries once the value is persisted server-side, so the
 * render overlay can never show a stale copy of a field the user just cleared.
 */
export function clearBusinessExtras(businessId: string, keys: readonly string[]): void {
  try {
    const prev = readBusinessExtras(businessId);
    if (!Object.keys(prev).length) return;
    const next: BusinessExtras = { ...prev };
    let changed = false;
    for (const k of keys) {
      if (k in next) {
        delete next[k as keyof BusinessExtras];
        changed = true;
      }
    }
    if (!changed) return;
    if (Object.keys(next).length) {
      localStorage.setItem(stashKey(businessId), JSON.stringify(next));
    } else {
      localStorage.removeItem(stashKey(businessId));
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/** True when a Supabase update failed only because columns are missing server-side. */
export function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; status?: unknown; message?: unknown };
  if (e.code === 'PGRST204') return true;
  return (
    e.status === 400 &&
    typeof e.message === 'string' &&
    /column|schema cache/i.test(e.message)
  );
}

/**
 * Overlay stashed extras onto EMPTY business fields only.
 * Pre-migration (DB null) -> local values show. Post-migration (DB set) -> DB wins.
 */
export function mergeBusinessExtras<T extends object>(
  business: T | null,
  businessId: string
): T | null {
  if (!business) return business;
  const stashed = readBusinessExtras(businessId);
  const out = { ...(business as Record<string, unknown>) };
  for (const k of DRIFTED_EXTRAS_KEYS) {
    const cur = out[k];
    const local = stashed[k];
    if ((cur === null || cur === undefined || cur === '') && local) {
      out[k] = local;
    }
  }
  return out as unknown as T;
}

/* ---------------------------------------------------------------------------
 * Generic column stash (PBS-149).
 *
 * Any business column the live DB does not have yet is stored here instead of
 * being sent (sending it is what produced the 400). Once the human applies the
 * migration the column shows up in the discovered schema and the stashed value
 * is flushed back into the database by `flushBusinessColumnStash`.
 * -------------------------------------------------------------------------*/

const columnStashKey = (businessId: string): string => `ax-business-columns:${businessId}`;

export function readBusinessColumnStash(businessId: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(columnStashKey(businessId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function stashBusinessColumns(businessId: string, values: Record<string, unknown>): void {
  try {
    const prev = readBusinessColumnStash(businessId);
    const next = { ...prev };
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined || v === '') delete next[k];
      else next[k] = v;
    }
    localStorage.setItem(columnStashKey(businessId), JSON.stringify(next));
  } catch {
    /* storage unavailable — values just won't persist locally */
  }
}

/**
 * Return the stashed values whose column now exists server-side and drop them
 * from the stash. The caller writes them to the DB in the same PATCH.
 */
export function flushBusinessColumnStash(
  businessId: string,
  existingColumns: Iterable<string>
): Record<string, unknown> {
  const stash = readBusinessColumnStash(businessId);
  const existing = new Set([...existingColumns].map((c) => String(c).toLowerCase()));
  const flushable: Record<string, unknown> = {};
  const remaining: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stash)) {
    if (existing.has(k.toLowerCase())) flushable[k] = v;
    else remaining[k] = v;
  }
  if (Object.keys(flushable).length) {
    try {
      if (Object.keys(remaining).length) {
        localStorage.setItem(columnStashKey(businessId), JSON.stringify(remaining));
      } else {
        localStorage.removeItem(columnStashKey(businessId));
      }
    } catch {
      /* ignore storage failures */
    }
  }
  return flushable;
}
