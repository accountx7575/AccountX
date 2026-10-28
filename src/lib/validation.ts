/**
 * Shared identity validation regexes. Single source of truth — SettingsPage's
 * profile form and the customer/supplier creation forms all import from here
 * (previously mirrored literals; keep the mirror trap dead).
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PHONE_REGEX = /^[+]?[0-9]{7,15}$/;
export const AADHAAR_REGEX = /^[0-9]{12}$/;

/**
 * Format 12-digit Aadhaar number as XXXX-XXXX-XXXX or XXXX XXXX XXXX
 */
export function formatAadhaar(val?: string | null, separator: '-' | ' ' = '-'): string {
  if (!val) return '';
  const digits = String(val).replace(/\D/g, '').slice(0, 12);
  if (digits.length <= 4) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 4)}${separator}${digits.slice(4)}`;
  return `${digits.slice(0, 4)}${separator}${digits.slice(4, 8)}${separator}${digits.slice(8, 12)}`;
}
