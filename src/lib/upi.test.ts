import { describe, it, expect } from 'vitest';
import { buildUpiUri } from '@/lib/upi';
import type { Business } from '@/types/db';

const base = {
  id: 'b1',
  name: 'Acme Traders',
  legal_name: 'Acme Traders Pvt Ltd',
} as Business;

describe('buildUpiUri', () => {
  it('returns null when business is null', () => {
    expect(buildUpiUri(null, 500)).toBeNull();
  });

  it('returns null when upi_id absent or blank', () => {
    expect(buildUpiUri(base, 500)).toBeNull();
    expect(buildUpiUri({ ...base, upi_id: '   ' } as Business, 500)).toBeNull();
    expect(buildUpiUri({ ...base, upi_id: '' } as Business, 500)).toBeNull();
  });

  it('returns null for zero or negative amounts', () => {
    const biz = { ...base, upi_id: 'acme@upi' } as Business;
    expect(buildUpiUri(biz, 0)).toBeNull();
    expect(buildUpiUri(biz, -10)).toBeNull();
  });

  it('builds a pay URI with encoded VPA, payee name and amount', () => {
    const uri = buildUpiUri({ ...base, upi_id: 'acme@upi' } as Business, 1234.5);
    expect(uri).toBe('upi://pay?pa=acme%40upi&pn=Acme%20Traders%20Pvt%20Ltd&am=1234.50&cu=INR');
  });

  it('trims whitespace around the VPA before encoding', () => {
    const uri = buildUpiUri({ ...base, upi_id: '  acme@okhdfc  ' } as Business, 1);
    expect(uri).toContain('pa=acme%40okhdfc');
  });

  it('falls back to name then Merchant for the payee', () => {
    const noLegal = buildUpiUri({ ...base, legal_name: undefined, upi_id: 'x@y' } as unknown as Business, 5);
    expect(noLegal).toContain('pn=Acme%20Traders');

    const bare = buildUpiUri({ id: 'b2', name: '', upi_id: 'x@y' } as unknown as Business, 5);
    expect(bare).toContain('pn=Merchant');
  });

  it('always fixes amount to two decimals with INR currency code', () => {
    const uri = buildUpiUri({ ...base, upi_id: 'a@b' } as Business, 7);
    expect(uri).toMatch(/am=7\.00&cu=INR$/);
  });
});
