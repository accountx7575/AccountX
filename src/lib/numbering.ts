import { supabase } from './supabase';
import { DOCUMENT_PREFIXES, type DocumentType } from './payloads';
import { normalizePrefix, docPrefixFor, DOC_PREFIX_KEYS, DOC_TYPE_PREFIX_KEY } from './docPrefixes';

const SUFFIX_RE = /(?:^|[/\-])(\d+)$/;
const MAX_PROBES = 25;

type AllocateOptions = {
  businessId: string;
  docType: DocumentType;
  table: string;
  numberColumn: string;
  date?: string;
  /** Configured per-business prefix (e.g. "EST" for quotations). Defaults to the doc-type default. */
  prefix?: string;
};

async function numberExists(table: string, column: string, businessId: string, value: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq('business_id', businessId)
    .eq(column, value)
    .limit(1);
  if (error) throw error;
  return !!(data && data.length > 0);
}

/** Escape Postgres LIKE wildcards inside a user-configured prefix. */
function likePattern(prefix: string): string {
  return prefix.replace(/[%_]/g, (ch) => ch === '%' ? '\\%' : '\\_');
}

/**
 * Uniqueness probe for a single document-number. Used by the create/edit forms to
 * gate the *save* with a duplicate guard before persisting. Reads via Supabase so
 * there is no counter-table write (human-gated counters stay untouched per
 * PBS-142 rules); forward references are unaffected (only the doc column itself).
 */
export async function documentNumberTaken({
  table,
  column,
  numberColumn,
  businessId,
  value,
  excludeId,
}: {
  table: string;
  /** The document-number column. `numberColumn` is accepted as an alias. */
  column?: string;
  numberColumn?: string;
  businessId: string;
  value: string;
  excludeId?: string;
}): Promise<boolean> {
  const docColumn = column || numberColumn;
  if (!docColumn) throw new Error('documentNumberTaken needs the document-number column');
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('business_id', businessId)
    .eq(docColumn, value)
    .neq('id', excludeId ?? '__none__');
  if (error) throw error;
  return !!(data && data.length > 0);
}

/** Replace the leading segment of PREFIX/fy/nn with `prefix` so the configured
 *  prefix always wins over whatever the counter RPC minted. */
export function swapPrefix(number: string, prefix: string): string {
  if (!number) return number;
  const idx = number.indexOf('/');
  if (idx === -1) return `${prefix}/${number}`;
  return `${prefix}/${number.slice(idx + 1)}`;
}

/**
 * Read the business's configured prefix for a document type. The six non-invoice
 * prefix columns may not exist server-side yet (human applies the migration),
 * so the read falls back to the invoice column and finally to the local stash
 * (pre-migration values) and the built-in default.
 */
async function resolveConfiguredPrefix(businessId: string, docType: DocumentType): Promise<string> {
  if (!DOC_TYPE_PREFIX_KEY[docType]) return '';
  let row: Record<string, unknown> | null = null;
  const { data, error } = await supabase
    .from('businesses')
    .select(DOC_PREFIX_KEYS.join(', '))
    .eq('id', businessId)
    .limit(1);
  if (!error) row = (data?.[0] as unknown as Record<string, unknown> | undefined) ?? null;
  if (!row) {
    const fallback = await supabase
      .from('businesses')
      .select('id, invoice_prefix')
      .eq('id', businessId)
      .limit(1);
    row = (fallback.data?.[0] as unknown as Record<string, unknown> | undefined) ?? null;
  }
  return docPrefixFor(row ? { ...row, id: businessId } : { id: businessId }, docType);
}

/**
 * Document-number allocator. The DB's existing rows are the source of truth:
 * every number already present for this business in `table` is scanned, the
 * highest trailing integer wins, and the allocation is max + 1 rendered in the
 * SAME format family as that row (SO/26-27/1 -> SO/26-27/2, SO/2026/000005 ->
 * SO/2026/000006, INV-12 -> INV-13). This self-heals counters that never saw
 * seeded/restored/manual numbers. The atomic next_document_number RPC is used
 * only when the table has no numbers yet; its leading segment is swapped to
 * the configured prefix so custom prefixes apply from the first number.
 */
export async function allocateDocumentNumber(opts: AllocateOptions): Promise<string> {
  const { businessId, docType, table, numberColumn, date } = opts;
  const explicit = normalizePrefix(opts.prefix);
  const configured = explicit || await resolveConfiguredPrefix(businessId, docType);
  const prefix = configured || DOCUMENT_PREFIXES[docType];

  const { data: rows, error: rowsError } = await supabase
    .from(table)
    .select(numberColumn)
    .eq('business_id', businessId)
    .or(`${numberColumn}.like.${likePattern(prefix)}/%,${numberColumn}.like.${likePattern(prefix)}-%`);
  if (rowsError) throw rowsError;

  let best: { head: string; digits: string; parsed: number } | null = null;
  for (const row of rows ?? []) {
    const raw = String((row as unknown as Record<string, unknown>)[numberColumn] ?? '');
    const match = SUFFIX_RE.exec(raw);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    if (!best || parsed > best.parsed) {
      best = { head: raw.slice(0, match.index + 1), digits: match[1], parsed };
    }
  }

  if (best) {
    const pad = best.digits.startsWith('0') ? best.digits.length : 0;
    for (let probe = 0; probe < MAX_PROBES; probe++) {
      const candidate = best.head + String(best.parsed + 1 + probe).padStart(pad, '0');
      if (!(await numberExists(table, numberColumn, businessId, candidate))) return candidate;
    }
    throw new Error(`Could not allocate a unique number — no free ${prefix} number within ${MAX_PROBES} probes of the highest used number`);
  }

  const rpcArgs = {
    p_business_id: businessId,
    p_doc_type: docType,
    ...(date ? { p_date: date } : {}),
  };
  const { data: generated, error: counterError } = await supabase.rpc('next_document_number', rpcArgs);
  if (counterError) throw counterError;
  const candidate = typeof generated === 'string' ? generated : '';
  if (!candidate) throw new Error('Numbering counter returned no value');
  return swapPrefix(candidate, prefix);
}
