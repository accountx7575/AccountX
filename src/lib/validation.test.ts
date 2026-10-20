import { describe, it, expect } from 'vitest';
import { GSTIN_REGEX, PAN_REGEX, PHONE_REGEX } from '@/lib/validation';

describe('GSTIN_REGEX — 15-char identity check', () => {
  it('accepts the canonical shape (2-digit state + PAN + entity + Z + checksum)', () => {
    expect(GSTIN_REGEX.test('27AAPFU0939F1ZV')).toBe(true);
    expect(GSTIN_REGEX.test('09ABCDE1234F1Z4')).toBe(true);
  });

  it('rejects malformed GSTINs', () => {
    expect(GSTIN_REGEX.test('27AAPFU0939F1Z')).toBe(false);   // 13 chars
    expect(GSTIN_REGEX.test('27AAPFU0939F1ZVX')).toBe(false); // 16 chars
    expect(GSTIN_REGEX.test('27AAPFU0939F1zV')).toBe(false);  // lowercase checksum
    expect(GSTIN_REGEX.test('27AAPFU0939F1AV')).toBe(false);  // non-Z 13th char
    expect(GSTIN_REGEX.test('27aapfu0939F1ZV')).toBe(false);  // lowercase PAN
    expect(GSTIN_REGEX.test('')).toBe(false); // empty-allowed lives in the guard
  });
});

describe('PAN_REGEX — 10-char ABCDE1234F', () => {
  it('accepts the canonical shape', () => {
    expect(PAN_REGEX.test('ABCDE1234F')).toBe(true);
  });

  it('rejects malformed PANs', () => {
    expect(PAN_REGEX.test('ABCDE12345')).toBe(false); // digit in holder char slot
    expect(PAN_REGEX.test('ABCDE123')).toBe(false); // 8 chars
    expect(PAN_REGEX.test('abcde1234F')).toBe(false); // lowercase
    expect(PAN_REGEX.test('')).toBe(false); // empty-allowed lives in the guard
  });
});

describe('PHONE_REGEX — 7-15 digits, optional leading + (warning-only gate)', () => {
  it('accepts valid local/international digits', () => {
    expect(PHONE_REGEX.test('9876543210')).toBe(true);  // 10 digits
    expect(PHONE_REGEX.test('1234567')).toBe(true);  // lower bound 7
    expect(PHONE_REGEX.test('123456789012345')).toBe(true);  // upper bound 15
    expect(PHONE_REGEX.test('+919876543210')).toBe(true);  // leading +
  });

  it('rejects out-of-bound or non-digit strings', () => {
    expect(PHONE_REGEX.test('123456')).toBe(false); // 6 digits
    expect(PHONE_REGEX.test('1234567890123456')).toBe(false); // 16 digits
    expect(PHONE_REGEX.test('98765-432-10')).toBe(false); // hyphens are stripped by the guard, not the regex
    expect(PHONE_REGEX.test('')).toBe(false);
  });
});
