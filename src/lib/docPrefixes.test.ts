// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PREFIXES,
  DOC_PREFIX_KEYS,
  normalizePrefix,
  isValidPrefix,
  readDocPrefixes,
  stashDocPrefixes,
} from './docPrefixes';

describe('normalizePrefix', () => {
  it('uppercases and keeps only A-Z 0-9 dash underscore dot', () => {
    expect(normalizePrefix('est')).toBe('EST');
    expect(normalizePrefix('ABC-Q')).toBe('ABC-Q');
    expect(normalizePrefix('in/v')).toBe('INV');
    expect(normalizePrefix('quote 01')).toBe('QUOTE01');
    expect(normalizePrefix('A'.repeat(20))).toBe('A'.repeat(12));
  });

  it('returns empty for unusable input so callers can fall back to the default', () => {
    expect(normalizePrefix('   ')).toBe('');
    expect(normalizePrefix(null)).toBe('');
    expect(normalizePrefix(undefined)).toBe('');
  });
});

describe('isValidPrefix', () => {
  it('accepts the documented charset and rejects the rest', () => {
    expect(isValidPrefix('EST')).toBe(true);
    expect(isValidPrefix('ABC-Q')).toBe(true);
    expect(isValidPrefix('a_b.c')).toBe(true);
    expect(isValidPrefix('A'.repeat(12))).toBe(true);
    expect(isValidPrefix('A'.repeat(13))).toBe(false);
    expect(isValidPrefix('IN V')).toBe(false);
    expect(isValidPrefix('IN/V')).toBe(false);
    expect(isValidPrefix('')).toBe(false);
  });
});

describe('readDocPrefixes', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to the defaults when nothing is configured', () => {
    expect(readDocPrefixes({ id: 'b1' })).toEqual(DEFAULT_PREFIXES);
  });

  it('prefers the stored database value over the local stash', () => {
    stashDocPrefixes('b1', { quotation_prefix: 'EST' });
    const prefixes = readDocPrefixes({ id: 'b1', quotation_prefix: 'QUO' });
    expect(prefixes.quotation_prefix).toBe('QUO');
  });

  it('uses the local stash while the column is missing server-side', () => {
    stashDocPrefixes('b1', { quotation_prefix: 'EST', sales_order_prefix: 'ORD' });
    const prefixes = readDocPrefixes({ id: 'b1' });
    expect(prefixes.quotation_prefix).toBe('EST');
    expect(prefixes.sales_order_prefix).toBe('ORD');
    expect(prefixes.invoice_prefix).toBe('INV');
  });

  it('keeps stashes separated per business', () => {
    stashDocPrefixes('b1', { quotation_prefix: 'EST' });
    expect(readDocPrefixes({ id: 'b2' }).quotation_prefix).toBe('QT');
  });

  it('exposes all seven prefix keys', () => {
    expect(Object.keys(readDocPrefixes({ id: 'b1' })).sort()).toEqual([...DOC_PREFIX_KEYS].sort());
  });

  it('keeps a partial stash from wiping the other stashed prefixes', () => {
    stashDocPrefixes('b1', { quotation_prefix: 'EST', sales_order_prefix: 'ORD' });
    stashDocPrefixes('b1', { quotation_prefix: 'QUO' });
    const prefixes = readDocPrefixes({ id: 'b1' });
    expect(prefixes.quotation_prefix).toBe('QUO');
    expect(prefixes.sales_order_prefix).toBe('ORD');
  });
});
