/* ============================================================================
 * Business schema discovery (PBS-149).
 *
 * The live DB can lag the app schema: some `public.businesses` columns
 * (numbering prefixes, tnc_*, registered_address, signature_name, pin_code,
 * is_active, plan_type, monthly_invoice_quota) do not exist until the human
 * applies the migration. A PATCH that includes a missing column fails with a
 * 400 (42703 / PGRST204) — that is the "Business Profile / PIN save" 400.
 *
 * PostgREST's OpenAPI spec is service_role-only, so column discovery has to be
 * a SELECT probe: ask for the candidate columns, read the unknown-column error,
 * drop that column, retry until the probe succeeds. The result is cached in
 * localStorage so the probe runs once per browser, not once per save.
 * ==========================================================================*/

import { supabase } from '@/lib/supabase';

/** Every column the app may try to write to public.businesses. */
export const BUSINESS_COLUMN_CANDIDATES = [
  'name', 'legal_name', 'business_type', 'phone', 'email', 'address', 'city', 'state',
  'pincode', 'country', 'gstin', 'pan', 'financial_year', 'currency', 'currency_symbol',
  'invoice_prefix', 'quotation_prefix', 'sales_order_prefix', 'purchase_order_prefix',
  'purchase_bill_prefix', 'credit_note_prefix', 'debit_note_prefix', 'gst_registered',
  'stamp_url', 'logo_url', 'signature_url', 'upi_id', 'upi_qr_url', 'invoice_footer_text',
  'invoice_signature_name', 'bank_name', 'bank_account_number', 'bank_ifsc_code',
  'account_name', 'tnc_invoice', 'tnc_quotation', 'tnc_sales_order', 'tnc_purchase',
  'registered_address', 'signature_name', 'pin_code', 'is_active', 'plan_type',
  'monthly_invoice_quota', 'owner_id',
] as const;

/** Columns verified PRESENT on the live DB (seed for the discovery cache). */
export const BUSINESS_KNOWN_PRESENT_COLUMNS = [
  'name', 'legal_name', 'business_type', 'phone', 'email', 'address', 'city', 'state',
  'pincode', 'country', 'gstin', 'pan', 'financial_year', 'currency', 'currency_symbol',
  'invoice_prefix', 'gst_registered', 'stamp_url', 'logo_url', 'signature_url', 'upi_id',
  'upi_qr_url', 'invoice_footer_text', 'invoice_signature_name', 'bank_name',
  'bank_account_number', 'bank_ifsc_code', 'account_name', 'owner_id',
] as const;

/** Columns that are known to be missing until the human applies the migration. */
export const BUSINESS_KNOWN_MISSING_COLUMNS = [
  'quotation_prefix', 'sales_order_prefix', 'purchase_order_prefix', 'purchase_bill_prefix',
  'credit_note_prefix', 'debit_note_prefix', 'tnc_invoice', 'tnc_quotation',
  'tnc_sales_order', 'tnc_purchase', 'registered_address', 'signature_name', 'pin_code',
  'is_active', 'plan_type', 'monthly_invoice_quota',
] as const;

const CACHE_KEY = 'ax:businesses:columns';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PROBE_ATTEMPTS = 24;

export interface ProbeResult {
  message?: string | null;
  /** Columns the probe learned about (only used by the `select('*')` probe). */
  columns?: string[];
}

export type ColumnProbe = (selectList: string[]) => Promise<ProbeResult | null>;

export function readCachedBusinessColumns(): string[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; columns?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.columns)) return null;
    if (typeof parsed.at === 'number' && Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.columns.filter((c): c is string => typeof c === 'string');
  } catch {
    return null;
  }
}

export function cacheBusinessColumns(columns: string[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), columns }));
  } catch {
    /* storage unavailable — discovery just re-probes next time */
  }
}

export function clearCachedBusinessColumns(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pull the column names out of a PostgREST unknown-column error.
 * Handles both shapes:
 *   "column businesses.quotation_prefix does not exist"  (42703)
 *   "Could not find the 'public' column 'quotation_prefix' in the schema cache" (PGRST204)
 */
export function parseMissingColumnNames(message: string | null | undefined): string[] {
  if (!message) return [];
  const found = new Set<string>();
  const re42703 = /column\s+(?:[A-Za-z0-9_."]+\.)*([a-z0-9_]+)\s+does not exist/gi;
  const rePgrst = /Could not find the '[^']+' column '([a-z0-9_]+)'/gi;
  for (const re of [re42703, rePgrst]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(message)) !== null) {
      if (m[1]) found.add(m[1].toLowerCase());
    }
  }
  return [...found];
}

export interface SplitPayload {
  /** Columns that exist server-side and can be written. */
  send: Record<string, unknown>;
  /** Columns the DB does not have (yet) — these must be stashed, never sent. */
  missing: Record<string, unknown>;
}

/** Split a payload into the part the DB can accept and the part it cannot. */
export function filterPayloadByColumns(
  payload: Record<string, unknown>,
  existingColumns: Iterable<string>,
): SplitPayload {
  const existing = new Set([...existingColumns].map((c) => String(c).toLowerCase()));
  const send: Record<string, unknown> = {};
  const missing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (existing.has(key.toLowerCase())) send[key] = value;
    else missing[key] = value;
  }
  return { send, missing };
}

/** Trim every string value. Addresses keep their '#', '-', '/', ',' characters —
 *  only surrounding whitespace goes away (no JSON-breaking transform). */
export function trimPayloadValues<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out as T;
}

export interface BusinessSavePlan {
  /** Columns that exist server-side — sent in the single PATCH. */
  send: Record<string, unknown>;
  /** Names of the columns the DB does not have (yet) — stashed, never sent. */
  missing: string[];
  /** The withheld values, keyed by column name. */
  missingValues: Record<string, unknown>;
  /** Keys that were stashed (for the user-facing toast). */
  stashed: string[];
  /** Document-number prefix values that need the prefix stash. */
  prefixStash: Record<string, string>;
  /** Drifted-extras values (legacy stash) that need the extras stash. */
  extrasStash: Record<string, unknown>;
}

export interface BusinessSavePlanOptions {
  /** Keys treated as document-number prefixes. */
  prefixKeys?: readonly string[];
  /** Keys treated as drifted business extras. */
  extrasKeys?: readonly string[];
  /** Normalizer applied to prefix values before they are stashed. */
  normalizePrefix?: (value: string) => string;
}

/**
 * Plan a business save: everything the DB has goes into `send`, everything it
 * does not have goes into `missing` (stashed locally, never sent). This is
 * what keeps the "Business Profile / PIN" save a single 204 PATCH instead of
 * a 400 + retry.
 */
export function planBusinessSave(
  payload: Record<string, unknown>,
  existingColumns: Iterable<string>,
  opts: BusinessSavePlanOptions = {},
): BusinessSavePlan {
  const { send, missing } = filterPayloadByColumns(payload, existingColumns);
  const stashed: string[] = [];
  const prefixStash: Record<string, string> = {};
  const extrasStash: Record<string, unknown> = {};
  const prefixKeys = opts.prefixKeys ?? [];
  const extrasKeys = opts.extrasKeys ?? [];

  for (const [key, value] of Object.entries(missing)) {
    if (prefixKeys.includes(key)) {
      const normalized = opts.normalizePrefix ? opts.normalizePrefix(String(value ?? '')) : String(value ?? '');
      if (normalized) {
        prefixStash[key] = normalized;
        stashed.push(key);
      }
      continue;
    }
    if (extrasKeys.includes(key)) {
      extrasStash[key] = value;
      stashed.push(key);
      continue;
    }
    if (typeof value === 'string' && value) stashed.push(key);
  }

  return {
    send,
    missing: Object.keys(missing),
    missingValues: missing,
    stashed,
    prefixStash,
    extrasStash,
  };
}

const STAR_SELECT = ['*'];

/**
 * Fast probe: `select('*')` returns one row whose keys ARE the table columns.
 * One round trip instead of one per missing column. If a column is not
 * exposed to the role PostgREST errors (PGRST203) and we fall back to the
 * iterative candidate probe.
 */
const starProbe: ColumnProbe = async (selectList) => {
  const select = selectList.length ? selectList.join(',') : '*';
  const { data, error } = await supabase.from('businesses').select(select).limit(1);
  if (error) return { message: error.message };
  const row = data && data.length ? (data[0] as unknown as Record<string, unknown>) : null;
  const columns = row ? Object.keys(row) : [];
  return { columns };
};

const defaultProbe: ColumnProbe = async (selectList) => {
  const { error } = await supabase.from('businesses').select(selectList.join(',')).limit(0);
  return error ? { message: error.message } : null;
};

/**
 * Discover the columns public.businesses actually has.
 * Cached; seeded with the verified-present list; falls back to that seed when
 * the probe cannot run (no select permission / network).
 */
export async function discoverBusinessColumns(probe?: ColumnProbe): Promise<string[]> {
  const cached = readCachedBusinessColumns();
  if (cached && cached.length) return cached;

  if (!probe) {
    // Fast path: one `select('*')` tells us every column the table exposes.
    const star = await starProbe(STAR_SELECT);
    if (star && star.columns && star.columns.length) {
      const present = [...new Set([...star.columns, ...BUSINESS_KNOWN_PRESENT_COLUMNS])];
      cacheBusinessColumns(present);
      return present;
    }
  }

  const runProbe = probe || defaultProbe;
  let working: string[] = [...BUSINESS_COLUMN_CANDIDATES];

  for (let attempt = 0; attempt < MAX_PROBE_ATTEMPTS; attempt++) {
    let failure: { message?: string | null } | null = null;
    try {
      failure = await runProbe(working);
    } catch {
      failure = { message: null };
    }
    if (!failure) {
      const present = [...new Set([...working, ...BUSINESS_KNOWN_PRESENT_COLUMNS])];
      cacheBusinessColumns(present);
      return present;
    }
    const missing = parseMissingColumnNames(failure.message).filter((c) => working.includes(c));
    if (missing.length === 0) {
      // Not a column problem (permission/network) — trust the verified seed.
      const seed = [...BUSINESS_KNOWN_PRESENT_COLUMNS];
      cacheBusinessColumns(seed);
      return seed;
    }
    working = working.filter((c) => !missing.includes(c));
  }

  const seed = [...BUSINESS_KNOWN_PRESENT_COLUMNS];
  cacheBusinessColumns(seed);
  return seed;
}
