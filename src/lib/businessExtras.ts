/* ============================================================================
 * Business extras resilience (schemafix-1002).
 * The live DB may lag the app schema (pincode / upi_qr_url / account_name).
 * Saves stash drifted values in localStorage; invoice rendering merges the
 * stash over empty business fields so local values show pre-migration and
 * DB values win post-migration. Saving NEVER crashes with a 400.
 * ==========================================================================*/

export interface BusinessExtras {
  pincode?: string | null;
  upi_qr_url?: string | null;
  account_name?: string | null;
}

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
