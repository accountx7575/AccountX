import { describe, it, expect } from 'vitest';
import { buildWhatsAppText, buildWhatsAppLink } from '@/lib/whatsapp';

const full = {
  partyName: 'Sharma Enterprises',
  docNumber: 'INV/2026/000042',
  dateDDMMYYYY: '24/08/2026',
  amountInr: '\u20B912,345.50',
  bank: { name: 'HDFC Bank', ifsc: 'HDFC0001234', upi: 'acme@upi' },
  partyPhone: '+91 98765-43210',
};

describe('buildWhatsAppText', () => {
  it('matches the owner template bytes exactly when all fields are present', () => {
    expect(buildWhatsAppText(full)).toBe(
      'Dear Sharma Enterprises, please find attached document INV/2026/000042 dated 24/08/2026 for \u20B912,345.50. Bank: HDFC Bank, IFSC: HDFC0001234, UPI: acme@upi.'
    );
  });

  it('omits the whole bank clause gracefully when no bank fields are set', () => {
    const text = buildWhatsAppText({ ...full, bank: undefined });
    expect(text).toBe(
      'Dear Sharma Enterprises, please find attached document INV/2026/000042 dated 24/08/2026 for \u20B912,345.50.'
    );
    expect(text).not.toContain('Bank');
    expect(text).not.toContain('UPI');
  });

  it('includes only the bank fields that are actually set (never placeholders)', () => {
    const text = buildWhatsAppText({ ...full, bank: { name: 'HDFC Bank', ifsc: null, upi: '  ' } });
    expect(text).toBe(
      'Dear Sharma Enterprises, please find attached document INV/2026/000042 dated 24/08/2026 for \u20B912,345.50. Bank: HDFC Bank.'
    );
  });

  it('keeps the rupee sign byte-exact in the amount position', () => {
    const text = buildWhatsAppText({ ...full, amountInr: '\u20B91.00' });
    expect(text).toContain('for \u20B91.00.');
  });

  it('trims surrounding whitespace on every interpolated field', () => {
    const text = buildWhatsAppText({
      ...full,
      partyName: '  Sharma Enterprises  ',
      docNumber: ' Q-1 ',
      dateDDMMYYYY: ' 01/09/2026 ',
      amountInr: ' \u20B99 ',
      bank: { name: ' B ', ifsc: ' I ', upi: ' U ' },
    });
    expect(text).toBe(
      'Dear Sharma Enterprises, please find attached document Q-1 dated 01/09/2026 for \u20B99. Bank: B, IFSC: I, UPI: U.'
    );
  });
});

describe('buildWhatsAppLink', () => {
  it('targets wa.me with digits-only phone when a phone exists', () => {
    const link = buildWhatsAppLink(full);
    expect(link.startsWith('https://wa.me/919876543210?')).toBe(true);
    expect('https://wa.me/' + full.partyPhone.replace(/\D/g, '')).not.toContain('+');
  });

  it('falls back to the phoneless wa.me share target without a phone', () => {
    const link = buildWhatsAppLink({ ...full, partyPhone: null });
    expect(link.startsWith('https://wa.me/?')).toBe(true);
    expect(link).toContain('text=');
  });

  it('treats a blanks-only phone as phoneless', () => {
    expect(buildWhatsAppLink({ ...full, partyPhone: '   ' }).startsWith('https://wa.me/?')).toBe(true);
  });

  it('URL-encodes the full message text including the rupee sign', () => {
    const link = buildWhatsAppLink(full);
    const decoded = decodeURIComponent(link.split('text=')[1]).replace(/\+/g, ' ');
    expect(decoded).toBe(buildWhatsAppText(full));
    expect(link).not.toContain('\u20B9');
    expect(link).not.toContain(' ');
  });
});
