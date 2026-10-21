/* ============================================================================
 * Document-numbering prefixes — per-business, settings-controlled.
 *
 * Default prefixes: invoice INV, quotation QT, sales order SO, purchase order
 * PO, purchase bill PB, credit note CN, debit note DN.
 *
 * The businesses table carries invoice_prefix today. The remaining six prefix
 * columns do not exist on the live DB yet (human applies the column
 * migration; see PBS-92 precedent). Until then values are stashed per business
 * in localStorage and overlaid on empty DB fields (DB wins post-migration).
 * Saving never crashes on missing columns — the Settings save path strips
 * unknown keys and retries (PGRST204-safe, businessExtras.ts pattern).
 * ========================================================================== */

export type DocPrefixKey =
  | 'invoice_prefix'
  | 'quotation_prefix'
  | 'sales_order_prefix'
  | 'purchase_order_prefix'
  | 'purchase_bill_prefix'
  | 'credit_note_prefix'
  | 'debit_note_prefix';

export const DOC_PREFIX_KEYS: DocPrefixKey[] = [
  'invoice_prefix',
  'quotation_prefix',
  'sales_order_prefix',
  'purchase_order_prefix',
  'purchase_bill_prefix',
  'credit_note_prefix',
  'debit_note_prefix',
];

/**
 * Prefix columns that do not exist on the live businesses table yet.
 * invoice_prefix is a real column and is always written to the DB.
 */
export const NEW_PREFIX_KEYS: DocPrefixKey[] = DOC_PREFIX_KEYS.filter((k) => k !== 'invoice_prefix');

export const DEFAULT_PREFIXES: Record<DocPrefixKey, string> = {
  invoice_prefix: 'INV',
  quotation_prefix: 'QT',
  sales_order_prefix: 'SO',
  purchase_order_prefix: 'PO',
  purchase_bill_prefix: 'PB',
  credit_note_prefix: 'CN',
  debit_note_prefix: 'DN',
};

const PREFIX_CHARS = /^[A-Za-z0-9\-_.]{1,12}$/;

/** Uppercase, strip anything but A-Z 0-9 dash underscore dot, cap at 12 chars. Empty -> ''. */
export function normalizePrefix(raw: string | null | undefined): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9\-_.]/g, '').slice(0, 12);
}

export function isValidPrefix(raw: string | null | undefined): boolean {
  return PREFIX_CHARS.test(String(raw ?? ''));
}

const stashKey = (businessId: string): string => `ax-doc-prefixes:${businessId}`;

function readDocPrefixStash(businessId: string): Partial<Record<DocPrefixKey, string>> {
  try {
    const raw = localStorage.getItem(stashKey(businessId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<Record<DocPrefixKey, string>> = {};
    for (const k of DOC_PREFIX_KEYS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function stashDocPrefixes(businessId: string, prefixes: Partial<Record<DocPrefixKey, string>>): void {
  try {
    const prev = readDocPrefixStash(businessId);
    const next: Record<string, string> = { ...prev };
    let changed = false;
    for (const k of DOC_PREFIX_KEYS) {
      if (!(k in prefixes)) continue;
      const v = (prefixes[k] || '').trim();
      if (v && next[k] !== v) { next[k] = v; changed = true; }
      else if (!v && next[k]) { delete next[k]; changed = true; }
    }
    if (changed) localStorage.setItem(stashKey(businessId), JSON.stringify(next));
  } catch {
    /* storage unavailable — prefixes just won't persist pre-migration */
  }
}

/** Resolve one prefix: configured DB value wins when set; otherwise stash; otherwise default. */
export function resolveDocPrefix(business: Record<string, unknown> | null | undefined, key: DocPrefixKey): string {
  const businessId = business && typeof business.id === 'string' ? business.id : '';
  const stashed: Partial<Record<DocPrefixKey, string>> = businessId ? readDocPrefixStash(businessId) : {};
  const dbVal = business?.[key];
  const dbStr = typeof dbVal === 'string' ? dbVal.trim() : '';
  if (dbStr) return dbStr;
  return stashed[key] || DEFAULT_PREFIXES[key];
}

/** Resolve all seven prefixes for a business (DB || stash || defaults). */
export function readDocPrefixes(business: Record<string, unknown> | null | undefined): Record<DocPrefixKey, string> {
  const out: Record<DocPrefixKey, string> = { ...DEFAULT_PREFIXES };
  for (const key of DOC_PREFIX_KEYS) out[key] = resolveDocPrefix(business, key);
  return out;
}

/** Which prefix setting drives which document type. */
export const DOC_TYPE_PREFIX_KEY: Record<string, DocPrefixKey> = {
  sales_invoice: 'invoice_prefix',
  quotation: 'quotation_prefix',
  sales_order: 'sales_order_prefix',
  purchase_order: 'purchase_order_prefix',
  purchase_bill: 'purchase_bill_prefix',
  credit_note: 'credit_note_prefix',
  debit_note: 'debit_note_prefix',
};

/** Configured prefix for a document type, for callers that hold the business row. */
export function docPrefixFor(
  business: Record<string, unknown> | null | undefined,
  docType: string
): string {
  const key = DOC_TYPE_PREFIX_KEY[docType];
  if (!key) return '';
  return resolveDocPrefix(business, key);
}

/** Stashed (pre-migration) prefix for a business, without a DB round-trip. */
export function stashedDocPrefix(businessId: string, key: DocPrefixKey): string {
  if (!businessId) return '';
  return readDocPrefixStash(businessId)[key] || '';
}
