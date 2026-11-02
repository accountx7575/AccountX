import { describe, it, expect } from 'vitest';
import { analyzePassword, entropyBitsFor, poolSizeFor, tierForBits } from '@/lib/passwordEntropy';

describe('poolSizeFor', () => {
  it('sums character-class pools', () => {
    expect(poolSizeFor('abc')).toBe(26);
    expect(poolSizeFor('abcXYZ')).toBe(52);
    expect(poolSizeFor('abcXYZ123')).toBe(62);
    expect(poolSizeFor('abcXYZ123!')).toBe(94);
  });
});

describe('entropyBitsFor', () => {
  it('computes bits = L * log2(poolSize)', () => {
    expect(entropyBitsFor('')).toBe(0);
    expect(entropyBitsFor('abcdefgh')).toBeCloseTo(8 * Math.log2(26), 10);
    expect(entropyBitsFor('Ab3!xQ9#mK2$')).toBeCloseTo(12 * Math.log2(94), 10);
  });
});

describe('tierForBits', () => {
  it('maps bit thresholds to tiers 1-4', () => {
    expect(tierForBits(0)).toBe(1);
    expect(tierForBits(29.9)).toBe(1);
    expect(tierForBits(30)).toBe(2);
    expect(tierForBits(49.9)).toBe(2);
    expect(tierForBits(50)).toBe(3);
    expect(tierForBits(69.9)).toBe(3);
    expect(tierForBits(70)).toBe(4);
    expect(tierForBits(200)).toBe(4);
  });
});

describe('analyzePassword', () => {
  it('returns tier 0 for empty passwords', () => {
    expect(analyzePassword('')).toEqual({ bits: 0, poolSize: 0, length: 0, tier: 0 });
  });

  it('grades weak and strong passwords', () => {
    expect(analyzePassword('password').tier).toBe(2);
    expect(analyzePassword('Tr#9vK$2mQ!xL7').tier).toBe(4);
  });
});
