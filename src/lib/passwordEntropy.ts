export type VaultTier = 0 | 1 | 2 | 3 | 4;

export interface EntropyReport {
  bits: number;
  poolSize: number;
  length: number;
  tier: VaultTier;
}

const LOWER = 26;
const UPPER = 26;
const DIGITS = 10;
const SYMBOLS = 32;

export function poolSizeFor(password: string): number {
  let pool = 0;
  if (/[a-z]/.test(password)) pool += LOWER;
  if (/[A-Z]/.test(password)) pool += UPPER;
  if (/[0-9]/.test(password)) pool += DIGITS;
  if (/[^A-Za-z0-9]/.test(password)) pool += SYMBOLS;
  return pool;
}

export function entropyBitsFor(password: string): number {
  if (!password) return 0;
  const pool = poolSizeFor(password);
  if (pool <= 1) return 0;
  return password.length * Math.log2(pool);
}

export function tierForBits(bits: number): VaultTier {
  if (bits < 30) return 1;
  if (bits < 50) return 2;
  if (bits < 70) return 3;
  return 4;
}

export function analyzePassword(password: string): EntropyReport {
  if (!password) {
    return { bits: 0, poolSize: 0, length: 0, tier: 0 };
  }
  const pool = poolSizeFor(password);
  const bits = entropyBitsFor(password);
  return { bits, poolSize: pool, length: password.length, tier: tierForBits(bits) };
}
