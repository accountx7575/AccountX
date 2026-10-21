import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PLANS_CONFIG,
  EARLY_ADOPTER_PROMO_TEXT,
  billsLimitLabel,
  getPlansConfig,
  getTier,
  resetPlansConfig,
  savePlansConfig,
  setDefaultTier,
  updateTier,
} from '@/lib/plansConfig';

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
  resetPlansConfig();
});

describe('plansConfig — defaults', () => {
  it('ships three tiers with the early-adopter tier as default', () => {
    const config = getPlansConfig();
    expect(config.tiers.map((t) => t.id)).toEqual(['early-adopter-beta', 'starter', 'pro-business']);
    expect(config.defaultTier).toBe('early-adopter-beta');
  });

  it('early-adopter tier is free and unlimited', () => {
    const tier = getTier('early-adopter-beta')!;
    expect(tier.monthlyBillsLimit).toBeNull();
    expect(tier.priceMonthly).toBeNull();
    expect(billsLimitLabel(tier)).toBe('Unlimited bills / mo');
  });

  it('starter tier is free up to 50 bills per month', () => {
    const tier = getTier('starter')!;
    expect(tier.monthlyBillsLimit).toBe(50);
    expect(tier.priceMonthly).toBeNull();
    expect(billsLimitLabel(tier)).toBe('50 bills / mo');
  });

  it('pro/business tier is paid with multi-user and priority support', () => {
    const tier = getTier('pro-business')!;
    expect(tier.monthlyBillsLimit).toBeNull();
    expect(tier.priceMonthly).not.toBeNull();
    expect(tier.multiUser).toBe(true);
    expect(tier.prioritySupport).toBe(true);
  });

  it('promo copy matches the mandated badge text', () => {
    expect(EARLY_ADOPTER_PROMO_TEXT).toBe(
      '100% Free — Create Unlimited GST Invoices & Bills (Limited Time Early Access)'
    );
  });
});

describe('plansConfig — admin knobs persist without refactor', () => {
  it('updates a tier limit and survives a re-read', () => {
    updateTier('starter', { monthlyBillsLimit: 120 });
    expect(getTier('starter')!.monthlyBillsLimit).toBe(120);
    expect(getPlansConfig().tiers.find((t) => t.id === 'starter')!.monthlyBillsLimit).toBe(120);
  });

  it('switches the default tier by data only', () => {
    setDefaultTier('pro-business');
    expect(getPlansConfig().defaultTier).toBe('pro-business');
  });

  it('toggles feature flags', () => {
    updateTier('starter', { multiUser: true, prioritySupport: true });
    const tier = getTier('starter')!;
    expect(tier.multiUser).toBe(true);
    expect(tier.prioritySupport).toBe(true);
  });

  it('reset restores shipped defaults', () => {
    updateTier('starter', { monthlyBillsLimit: 999 });
    setDefaultTier('pro-business');
    resetPlansConfig();
    const config = getPlansConfig();
    expect(config.defaultTier).toBe(DEFAULT_PLANS_CONFIG.defaultTier);
    expect(config.tiers.find((t) => t.id === 'starter')!.monthlyBillsLimit).toBe(50);
  });

  it('merges forward when a stored snapshot misses a field', () => {
    savePlansConfig({
      defaultTier: 'starter',
      tiers: [{ id: 'starter', label: 'Starter' } as never],
    });
    const config = getPlansConfig();
    expect(config.tiers).toHaveLength(3);
    expect(config.tiers.find((t) => t.id === 'starter')!.monthlyBillsLimit).toBe(50);
  });
});
