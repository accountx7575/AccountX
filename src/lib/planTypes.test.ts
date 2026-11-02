import { describe, it, expect } from 'vitest';
import {
  canonicalPlanTypeForWrite,
  DEFAULT_TIER_ID,
  isCanonicalTierId,
  LEGACY_FREE_TIER_MONTHLY_LIMIT,
  LEGACY_PRO_TIER_MONTHLY_LIMIT,
  legacyTierMirror,
  normalizePlanType,
  planTypeLabel,
  TIER_IDS,
  TIER_LABELS,
} from './planTypes';

describe('TIER_IDS', () => {
  it('is the canonical plansConfig tier union', () => {
    expect([...TIER_IDS]).toEqual(['early-adopter-beta', 'starter', 'pro-business']);
  });

  it('has a label for every tier', () => {
    for (const id of TIER_IDS) {
      expect(TIER_LABELS[id]).toBeTruthy();
    }
  });
});

describe('normalizePlanType', () => {
  it('maps empty values to the default tier', () => {
    expect(normalizePlanType(null)).toBe('early-adopter-beta');
    expect(normalizePlanType(undefined)).toBe('early-adopter-beta');
    expect(normalizePlanType('')).toBe('early-adopter-beta');
    expect(normalizePlanType('   ')).toBe('early-adopter-beta');
    expect(DEFAULT_TIER_ID).toBe('early-adopter-beta');
  });

  it('maps the early-adopter spellings', () => {
    expect(normalizePlanType('early-adopter-beta')).toBe('early-adopter-beta');
    expect(normalizePlanType('early_adopter_beta')).toBe('early-adopter-beta');
    expect(normalizePlanType('earlyadopterbeta')).toBe('early-adopter-beta');
    expect(normalizePlanType('Early_Adopter_Beta')).toBe('early-adopter-beta');
    expect(normalizePlanType('Free')).toBe('early-adopter-beta');
    expect(normalizePlanType('free')).toBe('early-adopter-beta');
  });

  it('maps the starter spellings', () => {
    expect(normalizePlanType('Starter')).toBe('starter');
    expect(normalizePlanType('starter')).toBe('starter');
    expect(normalizePlanType('STARTER')).toBe('starter');
  });

  it('maps the pro / enterprise spellings to pro-business', () => {
    expect(normalizePlanType('Pro')).toBe('pro-business');
    expect(normalizePlanType('pro')).toBe('pro-business');
    expect(normalizePlanType('Enterprise')).toBe('pro-business');
    expect(normalizePlanType('enterprise')).toBe('pro-business');
    expect(normalizePlanType('pro-business')).toBe('pro-business');
  });

  it('is case-insensitive and tolerates padding', () => {
    expect(normalizePlanType('  starter  ')).toBe('starter');
    expect(normalizePlanType('\tPRO\n')).toBe('pro-business');
  });

  it('returns null for an unknown value so the caller can decide', () => {
    expect(normalizePlanType('Gold')).toBeNull();
    expect(normalizePlanType('platinum')).toBeNull();
  });

  it('is idempotent', () => {
    for (const value of ['Free', 'Starter', 'Pro', 'Enterprise', 'early_adopter_beta', '']) {
      const once = normalizePlanType(value);
      if (once) expect(normalizePlanType(once)).toBe(once);
    }
  });
});

describe('canonicalPlanTypeForWrite', () => {
  it('always returns a canonical id', () => {
    expect(canonicalPlanTypeForWrite('Free')).toBe('early-adopter-beta');
    expect(canonicalPlanTypeForWrite('Starter')).toBe('starter');
    expect(canonicalPlanTypeForWrite('Enterprise')).toBe('pro-business');
    expect(canonicalPlanTypeForWrite('Gold')).toBe('early-adopter-beta');
    expect(canonicalPlanTypeForWrite(null)).toBe('early-adopter-beta');
  });
});

describe('isCanonicalTierId', () => {
  it('accepts only the canonical ids', () => {
    expect(isCanonicalTierId('starter')).toBe(true);
    expect(isCanonicalTierId('Starter')).toBe(false);
    expect(isCanonicalTierId('early_adopter_beta')).toBe(false);
    expect(isCanonicalTierId(null)).toBe(false);
  });
});

describe('planTypeLabel', () => {
  it('renders the canonical labels for every legacy spelling', () => {
    expect(planTypeLabel('Free')).toBe('Early-Adopter-Beta');
    expect(planTypeLabel('early_adopter_beta')).toBe('Early-Adopter-Beta');
    expect(planTypeLabel('Starter')).toBe('Starter');
    expect(planTypeLabel('Pro')).toBe('Pro / Business');
    expect(planTypeLabel('Enterprise')).toBe('Pro / Business');
  });

  it('shows an unknown value verbatim instead of hiding it', () => {
    expect(planTypeLabel('Gold')).toBe('Gold');
  });
});

describe('legacyTierMirror (PBS-156 write-through bridge)', () => {
  it('mirrors early-adopter-beta onto the legacy free tier with today\'s 50 cap', () => {
    expect(legacyTierMirror('early-adopter-beta')).toEqual({
      subscription_tier: 'free',
      max_invoices_per_month: 50,
    });
  });

  it('mirrors starter onto the legacy free tier with the 50 cap', () => {
    expect(legacyTierMirror('starter')).toEqual({
      subscription_tier: 'free',
      max_invoices_per_month: 50,
    });
  });

  it('mirrors pro-business onto the legacy pro tier with the tenant quota', () => {
    expect(legacyTierMirror('pro-business', 2000)).toEqual({
      subscription_tier: 'pro',
      max_invoices_per_month: 2000,
    });
  });

  it('falls back to 10000 for pro-business without a quota', () => {
    expect(legacyTierMirror('pro-business')).toEqual({
      subscription_tier: 'pro',
      max_invoices_per_month: LEGACY_PRO_TIER_MONTHLY_LIMIT,
    });
    expect(legacyTierMirror('pro-business', null)).toEqual({
      subscription_tier: 'pro',
      max_invoices_per_month: 10000,
    });
  });

  it('ignores a nonsensical quota', () => {
    expect(legacyTierMirror('pro-business', 0).max_invoices_per_month).toBe(10000);
    expect(legacyTierMirror('pro-business', -5).max_invoices_per_month).toBe(10000);
    expect(legacyTierMirror('pro-business', NaN).max_invoices_per_month).toBe(10000);
  });

  it('keeps the free cap at 50 regardless of the canonical quota', () => {
    expect(legacyTierMirror('starter', 500).max_invoices_per_month).toBe(
      LEGACY_FREE_TIER_MONTHLY_LIMIT,
    );
  });

  it('only writes legacy values the live CHECK constraint allows', () => {
    const allowed = ['free', 'starter', 'pro', 'enterprise'];
    for (const tier of TIER_IDS) {
      expect(allowed).toContain(legacyTierMirror(tier, 100).subscription_tier);
    }
  });
});
