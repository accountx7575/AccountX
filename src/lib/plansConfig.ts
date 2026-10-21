/**
 * Plans & tier config object (PBS-141).
 *
 * Central, serializable tier definition so switching the active/default tier
 * later (payments integration turn) is data-only: no component refactor.
 * Persisted to localStorage (`ax-plans-config-v1`) by the Super Admin plans
 * workspace; falls back to shipped defaults when absent/corrupt.
 *
 * Unlimited is represented as `null` (JSON-safe; no Infinity serialization).
 */

export type TierId = 'early-adopter-beta' | 'starter' | 'pro-business';
export type TierBillSort = 'free' | 'paid';

export type TierFlag = 'multiUser' | 'prioritySupport';

export interface TierConfig {
  id: TierId;
  label: string;
  tagline: string;
  /** null = unlimited bills per month. */
  monthlyBillsLimit: number | null;
  /** null = free (no price). Paid tiers carry a number (currency-agnostic). */
  priceMonthly: number | null;
  /** null = unlimited seats. */
  usersIncluded: number | null;
  multiUser: boolean;
  prioritySupport: boolean;
  /** Whether signups may land on this tier right now. */
  acceptingSignups: boolean;
  freeSort: TierBillSort;
}

export interface PlansConfigState {
  /** Tier applied to current/new tenants by default (data-only switch). */
  defaultTier: TierId;
  tiers: TierConfig[];
}

export const EARLY_ADOPTER_PROMO_TEXT =
  '100% Free — Create Unlimited GST Invoices & Bills (Limited Time Early Access)';

export const DEFAULT_PLANS_CONFIG: PlansConfigState = {
  defaultTier: 'early-adopter-beta',
  tiers: [
    {
      id: 'early-adopter-beta',
      label: 'Early-Adopter-Beta',
      tagline: 'Free unlimited while early access lasts — current default tier.',
      monthlyBillsLimit: null,
      priceMonthly: null,
      usersIncluded: 1,
      multiUser: false,
      prioritySupport: true,
      acceptingSignups: true,
      freeSort: 'free',
    },
    {
      id: 'starter',
      label: 'Starter',
      tagline: 'Free up to 50 bills per month.',
      monthlyBillsLimit: 50,
      priceMonthly: null,
      usersIncluded: 1,
      multiUser: false,
      prioritySupport: false,
      acceptingSignups: false,
      freeSort: 'free',
    },
    {
      id: 'pro-business',
      label: 'Pro / Business',
      tagline: 'Paid: unlimited bills, multi-user seats and priority support.',
      monthlyBillsLimit: null,
      priceMonthly: 999,
      usersIncluded: null,
      multiUser: true,
      prioritySupport: true,
      acceptingSignups: false,
      freeSort: 'paid',
    },
  ],
};

const STORAGE_KEY = 'ax-plans-config-v1';
const CHANGE_EVENT = 'ax-plans-config-changed';

export const PLANS_CONFIG_CHANGE_EVENT = CHANGE_EVENT;
export const PLANS_CONFIG_STORAGE_KEY = STORAGE_KEY;

function readConfig(): PlansConfigState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tiers)) return null;
    return parsed as PlansConfigState;
  } catch {
    return null;
  }
}

function writeConfig(state: PlansConfigState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  } catch {
    /* storage full/unavailable — edits stay in-memory for the session */
  }
}

export function getPlansConfig(): PlansConfigState {
  const stored = readConfig();
  if (stored) {
    // Merge forward: defaults guarantee every tier/flag exists even if the
    // stored snapshot predates a field addition.
    const merged = DEFAULT_PLANS_CONFIG.tiers.map((def) => {
      const found = stored.tiers.find((t) => t.id === def.id);
      return found ? { ...def, ...found } : { ...def };
    });
    const order = (t: TierConfig) => DEFAULT_PLANS_CONFIG.tiers.findIndex((d) => d.id === t.id);
    return { defaultTier: stored.defaultTier || DEFAULT_PLANS_CONFIG.defaultTier, tiers: [...merged].sort((a, b) => order(a) - order(b)) };
  }
  return { ...DEFAULT_PLANS_CONFIG, tiers: DEFAULT_PLANS_CONFIG.tiers.map((t) => ({ ...t })) };
}

export function savePlansConfig(state: PlansConfigState): void {
  writeConfig(state);
}

export function resetPlansConfig(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function updateTier(id: TierId, patch: Partial<TierConfig>): PlansConfigState {
  const state = getPlansConfig();
  const next: PlansConfigState = {
    ...state,
    tiers: state.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
  savePlansConfig(next);
  return next;
}

export function setDefaultTier(id: TierId): PlansConfigState {
  const next: PlansConfigState = { ...getPlansConfig(), defaultTier: id };
  savePlansConfig(next);
  return next;
}

export function getTier(id: TierId): TierConfig | undefined {
  return getPlansConfig().tiers.find((t) => t.id === id);
}

/**
 * HumanQA note (do not wire yet): enforcement of monthlyBillsLimit against
 * live document creation counts belongs to the payments turn; the config
 * object is the single source the future checker will read.
 */
export function billsLimitLabel(tier: TierConfig): string {
  return tier.monthlyBillsLimit === null ? 'Unlimited bills / mo' : `${tier.monthlyBillsLimit} bills / mo`;
}
