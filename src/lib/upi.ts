import type { Business } from '@/types/db';

/** Builds a UPI deep-link URI for QR payments; returns null when no UPI id on record. */
export function buildUpiUri(business: Business | null, amount: number): string | null {
  const upiId = (business as (Business & { upi_id?: string }) | null)?.upi_id?.trim();
  if (!upiId || !(amount > 0)) return null;
  const name = encodeURIComponent(business?.legal_name || business?.name || 'Merchant');
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${name}&am=${amount.toFixed(2)}&cu=INR`;
}
