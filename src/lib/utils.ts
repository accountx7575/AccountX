import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type FormatCurrencyOptions = {
  noSymbol?: boolean;
  trimZeroDecimals?: boolean;
};

export function formatCurrency(
  amount: number | null | undefined,
  currency = '₹',
  opts: FormatCurrencyOptions = {}
): string {
  const noSymbol = opts.noSymbol === true || currency === '';
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `${noSymbol ? '' : currency}${opts.trimZeroDecimals ? '0' : '0.00'}`;
  }
  const hasPaise = Math.round(Number(amount) * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: opts.trimZeroDecimals && !hasPaise ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  return `${noSymbol ? '' : currency}${formatted}`;
}

/** Document address block: line 1 = street address, line 2 = 'City, State - Pincode'. */
export function formatAddress2Line(loc: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string {
  const line1 = String(loc.address || '').trim();
  const line2Base = [loc.city, loc.state].map((v) => String(v || '').trim()).filter(Boolean).join(', ');
  const line2Full = loc.pincode
    ? line2Base
      ? `${line2Base} - ${String(loc.pincode).trim()}`
      : String(loc.pincode).trim()
    : line2Base;
  const alreadyIncluded = !!(line1 && line2Full && line1.toLowerCase().includes(line2Full.toLowerCase()));
  return [line1, !alreadyIncluded && line2Full ? line2Full : ''].filter(Boolean).join('\n');
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return new Intl.NumberFormat('en-IN').format(Number(num));
}

/** Project-wide standard: strict Indian DD/MM/YYYY (e.g. 24/08/2026). */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/**
 * Document header dates print as strict Indian DD/MM/YYYY (e.g. 24/08/2026).
 * Callers hand over whatever the database holds — an ISO '2026-08-24', a
 * timestamp, or an already formatted '24/08/2026' — so the value is
 * normalised here instead of letting a raw ISO date leak into the print.
 * ISO values are split part-wise, never through new Date(), so the day can
 * never shift with the reader's timezone.
 */
export function formatDocDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
  }
  const raw = String(value).trim();
  if (!raw) return '';
  // Already DD/MM/YYYY (or D/M/YYYY, or with dashes).
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (dmy) return `${pad2(dmy[1])}/${pad2(dmy[2])}/${dmy[3]}`;
  // ISO 2026-08-24, with or without a time part.
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (ymd) return `${pad2(ymd[3])}/${pad2(ymd[2])}/${ymd[1]}`;
  const formatted = formatDate(raw);
  return formatted === '—' ? raw : formatted;
}

/** Long form where space allows: DD MMM YYYY (e.g. 24 Aug 2026). */
export function formatLongDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 12-hour clock label for document headers (e.g. '05:45 PM'). Empty string when unusable. */
export function formatTimeOfDay(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function toDateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

export function todayDateString(): string {
  return toDateString(new Date());
}

export function getLocalNowTime(): string {
  return new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function combineDateTime(dateStr: string, timeStr?: string): string {
  if (!dateStr) return new Date().toISOString();
  const rawDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  if (!timeStr || !timeStr.trim()) {
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) {
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4]?.toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  const parts = rawDate.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    const d = new Date(parts[0], parts[1] - 1, parts[2], hours, minutes, seconds);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return new Date().toISOString();
  d.setHours(hours, minutes, seconds, 0);
  return d.toISOString();
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function generateInvoiceNumber(prefix: string, sequence: number): string {
  const year = new Date().getFullYear();
  const padded = String(sequence).padStart(4, '0');
  return `${prefix}/${year}/${padded}`;
}

export function roundTo2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${hundreds ? ONES[hundreds] + ' Hundred' : ''}${hundreds && rest ? ' ' : ''}${rest ? twoDigits(rest) : ''}`;
}

export function numberToWordsIndian(num: number): string {
  const prefix = num < 0 ? 'Negative ' : '';
  const n = Math.floor(Math.abs(num));
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return prefix + parts.join(' ');
}

export function amountInWordsIndian(amount: number): string {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let words = `${numberToWordsIndian(rupees)} Rupees`;
  if (paise > 0) words += ` and ${numberToWordsIndian(paise)} Paise`;
  return `${words} Only`;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

/**
 * Format round off value according to standard accounting conventions:
 * e.g., -₹0.05, +₹0.48, or ₹0.00
 */
export function formatRoundOff(
  val: number | string | null | undefined,
  currency = '₹'
): string {
  const num = Number(val || 0);
  if (isNaN(num) || Math.abs(num) < 0.0001) return `${currency}0.00`;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(num));
  if (num > 0) return `+${currency}${formatted}`;
  if (num < 0) return `-${currency}${formatted}`;
  return `${currency}0.00`;
}

