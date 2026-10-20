/**
 * Shared identity validation regexes. Single source of truth — SettingsPage's
 * profile form and the customer/supplier creation forms all import from here
 * (previously mirrored literals; keep the mirror trap dead).
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PHONE_REGEX = /^[+]?[0-9]{7,15}$/;
