/* ============================================================================
 * Canonical plan tier ids (PBS-153).
 *
 * The businesses.plan_type column used to carry free-form strings written by
 * the legacy Super Admin console ('Free', 'Starter', 'Pro', 'Enterprise') next
 * to the plansConfig tier ids ('early-adopter-beta', 'starter', 'pro-business')
 * and the migration default ('early_adopter_beta'). Three spellings of the
 * same tier in one column is why the plan could never be counted reliably.
 *
 * DECISION (god): the canonical set is the plansConfig TierId union -
 *   'early-adopter-beta' | 'starter' | 'pro-business'
 * and the legacy console names become display labels only. Every read of
 * plan_type goes through `normalizePlanType`, every write stores a canonical
 * id, and the migration backfills the old spellings.
 *
 * NOTE: src/lib/plansConfig.ts is owned by another lane and is NOT touched
 * here - the two are integrated later.
 * ==========================================================================*/

/** The canonical tier ids. */
export const TIER_IDS = ['early-adopter-beta', 'starter', 'pro-business'] as const;

export type CanonicalTierId = (typeof TIER_IDS)[number];

/** The tier a business sits on when plan_type is empty. */
export const DEFAULT_TIER_ID: CanonicalTierId = 'early-adopter-beta';

/**
 * Every spelling that may be found in the column, mapped to its canonical id.
 * Keys are matched case-insensitively after trimming.
 */
const TIER_ALIASES: Record<string, CanonicalTierId> = {
  // early-adopter-beta
  'early-adopter-beta': 'early-adopter-beta',
  'early_adopter_beta': 'early-adopter-beta',
  'earlyadopterbeta': 'early-adopter-beta',
  'early adopter beta': 'early-adopter-beta',
  free: 'early-adopter-beta',
  // starter
  starter: 'starter',
  // pro-business
  pro: 'pro-business',
  'pro-business': 'pro-business',
  'pro business': 'pro-business',
  enterprise: 'pro-business',
};

export function isCanonicalTierId(value: unknown): value is CanonicalTierId {
  return typeof value === 'string' && (TIER_IDS as readonly string[]).includes(value);
}

/**
 * Map any stored spelling to its canonical tier id.
 *
 * - empty / null / undefined -> the default tier ('early-adopter-beta'),
 *   exactly like the column default and the migration backfill
 * - a known legacy spelling (any case, padded) -> its canonical id
 * - an unknown non-empty value -> null (the caller decides: display the raw
 *   value, or fall back)
 */
export function normalizePlanType(value: string | null | undefined): CanonicalTierId | null {
  if (value === null || value === undefined) return DEFAULT_TIER_ID;
  const raw = String(value).trim();
  if (!raw) return DEFAULT_TIER_ID;
  const hit = TIER_ALIASES[raw.toLowerCase()];
  return hit ?? null;
}

/**
 * Canonical tier id for a value that is about to be WRITTEN. Unknown values
 * fall back to the default tier so the column never stores a spelling that
 * cannot be read back.
 */
export function canonicalPlanTypeForWrite(value: string | null | undefined): CanonicalTierId {
  return normalizePlanType(value) ?? DEFAULT_TIER_ID;
}

/** Display label per canonical tier (the legacy names are labels only). */
export const TIER_LABELS: Record<CanonicalTierId, string> = {
  'early-adopter-beta': 'Early-Adopter-Beta',
  starter: 'Starter',
  'pro-business': 'Pro / Business',
};

/**
 * Human label for a stored plan_type. Known spellings resolve to the canonical
 * label; an unknown value is shown verbatim so nothing is hidden.
 */
export function planTypeLabel(value: string | null | undefined): string {
  const canonical = normalizePlanType(value);
  if (canonical) return TIER_LABELS[canonical];
  const raw = String(value ?? '').trim();
  return raw;
}
